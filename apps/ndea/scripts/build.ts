#!/usr/bin/env bun

/**
 * Build the nd-embedding-atlas single binary: one Bun.build `compile` of the
 * CLI. The server's `index.html` import makes it a full-stack executable: Bun
 * bundles the frontend (frontend-plugin.ts, NODE_ENV=production) into the
 * binary and `Bun.serve` serves that manifest.
 *
 * DuckDB: darwin-arm64 swaps in a duckdb.node with DuckDB statically linked
 * (scripts/build-duckdb-addon.ts); other targets embed libduckdb so the
 * preloader can dlopen it at runtime.
 *
 * Usage:
 *   vp run build                                      # current platform
 *   vp run build --target=bun-linux-x64               # specific target
 *
 * `vp run build` runs the cached `--addon-only` task (static duckdb.node),
 * then this script without it.
 *
 * Output: dist/ndea: single self-contained binary. On darwin-arm64 nothing
 * is extracted besides Bun's own native-addon temp file. Other targets embed
 * libduckdb; the preloader extracts it to ~/.cache/ndea/<version>/ at first
 * run and dlopens it before @duckdb/node-api evaluates.
 */

import { existsSync, rmSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { COLUMN_WORKER_ENTRYPOINT } from "@ndea/zarr/build";
import { CROP_WORKER_ENTRYPOINT } from "../src/server/crop-worker-path.ts";
import { buildStaticDuckDBAddon } from "./build-duckdb-addon.ts";
import frontendPlugin from "./frontend-plugin.ts";

// ─── Args ──────────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
const targetArg = args.find((a) => !a.startsWith("--") || a.startsWith("--target="));
const hostTargetOs = process.platform === "win32" ? "windows" : process.platform;
const target =
  (targetArg?.startsWith("--target=") ? targetArg.slice("--target=".length) : targetArg) ??
  `bun-${hostTargetOs}-${process.arch}`;

const APP_ROOT = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(APP_ROOT, "../..");
const OUT_DIR = resolve(REPO_ROOT, "dist");
const LIBDUCKDB_STUB_PATH = resolve(APP_ROOT, "src/cli/lib/__generated-libduckdb.ts");
const libduckdbStub = await Bun.file(LIBDUCKDB_STUB_PATH).text();

// ─── Target → DuckDB binding mapping ───────────────────────────────────────
//
// Each `bun --target` value maps to a `@duckdb/node-bindings-<platform>`
// dir in node_modules that ships duckdb.node + libduckdb.<ext>. Both get
// embedded into $bunfs/: duckdb.node via bun's native-addon extraction,
// libduckdb via `with { type: "file" }` import in __generated-libduckdb.ts.

interface DuckDBTarget {
  /** Subdir under node_modules/@duckdb/. */
  bindingsDir: string;
  /**
   * Shared-library filename as shipped inside the bindings package. Windows
   * ships `duckdb.dll`, not `libduckdb.dll`: the name is what duckdb.node
   * imports, so the preloader must materialize it under this exact basename.
   */
  libFile: string;
}

const TARGET_TO_DUCKDB: Record<string, DuckDBTarget> = {
  "bun-darwin-arm64": { bindingsDir: "node-bindings-darwin-arm64", libFile: "libduckdb.dylib" },
  "bun-darwin-x64": { bindingsDir: "node-bindings-darwin-x64", libFile: "libduckdb.dylib" },
  "bun-linux-arm64": { bindingsDir: "node-bindings-linux-arm64", libFile: "libduckdb.so" },
  "bun-linux-x64": { bindingsDir: "node-bindings-linux-x64", libFile: "libduckdb.so" },
  "bun-windows-x64": { bindingsDir: "node-bindings-win32-x64", libFile: "duckdb.dll" },
};

const duckdbTarget = TARGET_TO_DUCKDB[target];
if (!duckdbTarget) {
  console.error(`\n  Error: unknown target ${target}. Supported: ${Object.keys(TARGET_TO_DUCKDB).join(", ")}\n`);
  process.exit(1);
}

// ─── ANSI helpers ──────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const startedAt = performance.now();

if (args.includes("--addon-only")) {
  // Only darwin-arm64 links DuckDB statically; other targets have nothing to prebuild.
  if (target === "bun-darwin-arm64") {
    console.log(`  ${GREEN}✓${RESET} static duckdb.node: ${relative(REPO_ROOT, await buildStaticDuckDBAddon())}`);
  }
  process.exit(0);
}

const outfile = resolve(OUT_DIR, target.startsWith("bun-windows-") ? "ndea.exe" : "ndea");
let compileExit = 1;
try {
  // ponytail: static DuckDB only for darwin-arm64 (spike). Other targets keep
  // the npm addon + embedded libduckdb until build-duckdb-addon.ts covers them.
  const staticAddon = target === "bun-darwin-arm64" ? await buildStaticDuckDBAddon() : null;
  if (staticAddon) {
    console.log(`  ${GREEN}✓${RESET} static duckdb.node: ${relative(REPO_ROOT, staticAddon)}`);
  } else {
    // libduckdb embed manifest: overwrites the committed dev stub
    // (LIBDUCKDB_EMBEDDED_PATH = null) with a real `with { type: "file" }`
    // import for the build target's libduckdb. Restored in the finally block.
    const dylibAbsPath = resolve(APP_ROOT, "node_modules/@duckdb", duckdbTarget.bindingsDir, duckdbTarget.libFile);
    if (!existsSync(dylibAbsPath)) {
      throw new Error(`${dylibAbsPath} not found. Run \`vp install\` first.`);
    }
    const dylibRelPath = relative(dirname(LIBDUCKDB_STUB_PATH), dylibAbsPath).replaceAll("\\", "/");
    await Bun.write(
      LIBDUCKDB_STUB_PATH,
      [
        "// AUTO-GENERATED by scripts/build.ts: do not commit.",
        `import libduckdbPath from "${dylibRelPath}" with { type: "file" };`,
        "export const LIBDUCKDB_EMBEDDED_PATH: string | null = libduckdbPath;",
        "",
      ].join("\n"),
    );
    console.log(`  ${GREEN}✓${RESET} libduckdb embedded: ${dylibRelPath}`);
  }

  // ─── Compile binary ────────────────────────────────────────────────────────

  console.log(`\n  ${BOLD}Compiling${RESET} binary for ${target}...\n`);

  // @duckdb/node-bindings/duckdb.js branches through every platform's
  // native addon via require(). Only the matching optional dep for the
  // build target is needed; everything else gets externalized so the
  // bundler doesn't try to resolve missing optional deps.
  //
  // The matching one is NOT externalized: the compiler embeds duckdb.node
  // into $bunfs/, where it's extracted to a temp path at runtime and
  // dlopen'd. With a static addon, a resolver plugin points that require at
  // it; otherwise libduckdb resolves via the preloader's process-level
  // dlopen, not via duckdb.node's rpath.
  //
  // musl variants are externalized only: we never build for Alpine/musl.
  const ALL_DUCKDB_TARGETS = [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-arm64-musl",
    "linux-x64",
    "linux-x64-musl",
    "win32-arm64",
    "win32-x64",
  ];
  const matchingPlatform = duckdbTarget.bindingsDir.replace(/^node-bindings-/, "");
  const DUCKDB_PLATFORM_EXTERNALS = ALL_DUCKDB_TARGETS.filter((p) => p !== matchingPlatform).map(
    (p) => `@duckdb/node-bindings-${p}/duckdb.node`,
  );

  // Worker scripts must be passed as additional entrypoints so the bundler
  // recursively resolves their imports. Bun emits each as `<name>.js` next
  // to the main entry inside $bunfs; parallel-reader.ts switches its URL
  // extension to match when running compiled.
  const ADDITIONAL_ENTRYPOINTS = [COLUMN_WORKER_ENTRYPOINT, CROP_WORKER_ENTRYPOINT];

  const result = await Bun.build({
    // Worker paths are repo-relative; `root` keeps their $bunfs paths stable.
    entrypoints: ["./apps/ndea/src/cli/index.ts", ...ADDITIONAL_ENTRYPOINTS].map((p) => resolve(REPO_ROOT, p)),
    root: REPO_ROOT,
    compile: {
      target: target as Bun.Build.CompileTarget,
      outfile,
      // Profile-guided bytecode layout, most common start first. Re-record: `vp run bytecode-order`, then rebuild.
      bytecodeOrder: ["view", "help", "version", "workspace-get"].map((name) =>
        resolve(import.meta.dir, "bytecode-order", `${name}.order`),
      ),
    },
    format: "esm",
    bytecode: true,
    minify: true,
    // With `compile`, embeds a zstd-compressed sourcemap so stack traces show src/**/*.ts:line.
    sourcemap: "linked",
    // Splits the server and the embedded client bundle; the client's lazy component chunks load on demand.
    splitting: true,
    // The frontend's one dev/prod switch (and React's production build) for the embedded client bundle.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    external: DUCKDB_PLATFORM_EXTERNALS,
    plugins: [
      frontendPlugin,
      ...(staticAddon
        ? [
            {
              name: "static-duckdb-addon",
              setup(build: Bun.PluginBuilder) {
                const filter = new RegExp(`^@duckdb/node-bindings-${matchingPlatform}/duckdb\\.node$`);
                build.onResolve({ filter }, () => ({ path: staticAddon }));
              },
            },
          ]
        : []),
    ],
    throw: false,
  });
  for (const log of result.logs) console.error(log);
  // The binary embeds the sourcemaps it needs; Bun also writes every chunk's .map beside it.
  for (const output of result.outputs) if (output.path.endsWith(".map")) rmSync(output.path);
  compileExit = result.success ? 0 : 1;
} finally {
  await Bun.write(LIBDUCKDB_STUB_PATH, libduckdbStub);
}

if (compileExit !== 0) {
  console.error(`\n  ${RED}Compile failed with exit code ${compileExit}${RESET}`);
  process.exit(1);
}

// ─── Done ──────────────────────────────────────────────────────────────────

const sizeMB = (Bun.file(outfile).size / 1024 / 1024).toFixed(1);
const relOut = relative(process.cwd(), outfile);
const elapsed = `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;

console.log(`\n  ${GREEN}✓${RESET} Binary: ${BOLD}${relOut}${RESET} ${DIM}(${sizeMB} MB)${RESET}`);
console.log(`  ${DIM}Target: ${target} · built in ${elapsed}${RESET}\n`);
console.log(`  ${DIM}Version: \`${relOut} --version\`${RESET}\n`);
