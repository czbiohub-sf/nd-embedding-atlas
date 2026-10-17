#!/usr/bin/env bun

/**
 * Build the nd-embedding-atlas single binary.
 *
 * Steps:
 *   1. Build frontend (Bun.build)
 *   2. Enumerate dist/frontend/** files for embedding
 *   3. Embed DuckDB: darwin-arm64 swaps in a duckdb.node with DuckDB
 *      statically linked (scripts/build-duckdb-addon.ts); other targets embed
 *      libduckdb so the preloader can dlopen it at runtime
 *   4. Compile binary (Bun.build `compile`)
 *
 * Usage:
 *   vp run build                                      # current platform
 *   vp run build --target=bun-linux-x64               # specific target
 *
 * `vp run build` runs the cached `--frontend-only` (step 1) and
 * `--addon-only` (static duckdb.node) tasks, then `--compile-only`
 * (steps 2-4 against the existing dist/frontend). No flag runs everything.
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
const only = args.find((a) => a === "--frontend-only" || a === "--addon-only" || a === "--compile-only");
const targetArg = args.find((a) => !a.startsWith("--") || a.startsWith("--target="));
const hostTargetOs = process.platform === "win32" ? "windows" : process.platform;
const target =
  (targetArg?.startsWith("--target=") ? targetArg.slice("--target=".length) : targetArg) ??
  `bun-${hostTargetOs}-${process.arch}`;

const APP_ROOT = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(APP_ROOT, "../..");
const FRONTEND_DIST = resolve(REPO_ROOT, "dist/frontend");
const OUT_DIR = resolve(REPO_ROOT, "dist");
const FRONTEND_MANIFEST_PATH = resolve(APP_ROOT, "src/server/__generated-embedded-assets.ts");
const LIBDUCKDB_STUB_PATH = resolve(APP_ROOT, "src/cli/lib/__generated-libduckdb.ts");
const [frontendManifestStub, libduckdbStub] = await Promise.all([
  Bun.file(FRONTEND_MANIFEST_PATH).text(),
  Bun.file(LIBDUCKDB_STUB_PATH).text(),
]);

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

// ─── Frontend bundle (Bun.build) ────────────────────────────────────────────
//
// Bundles the frontend with Bun's own bundler, the same one `vp run dev`
// serves through. frontend-plugin.ts (Tailwind v4 + TypeGPU) is the one plugin
// set for both. The output (dist/frontend/**) is what Step 2 globs.
async function buildFrontendWithBun(): Promise<void> {
  // Bun.build writes into outdir without clearing it: wipe any stale
  // output first so the manifest globs only this build's files.
  rmSync(FRONTEND_DIST, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [resolve(APP_ROOT, "index.html")],
    outdir: FRONTEND_DIST,
    target: "browser",
    minify: true,
    // No sourcemaps: they'd be globbed into the embed manifest and bloat the
    // compiled binary by ~15MB.
    sourcemap: "none",
    // ponytail: splitting disabled: with `splitting: true`, Bun.build emitted an
    // index.html whose entry chunk's import closure never reached the createRoot
    // chunk, so the compiled binary served a blank page (React never mounted). A
    // single self-contained bundle is fine for a locally-served single binary :
    // there's no network to amortize split chunks over. Re-enable if Bun fixes the
    // HTML-entry-under-splitting wiring.
    splitting: false,
    // The frontend's one dev/prod switch: the Bun dev server inlines
    // "development", Bun.build would too unless told otherwise. Also selects
    // React's production build.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [frontendPlugin],
  });

  if (!result.success) {
    console.error(`\n  ${RED}Bun.build frontend failed:${RESET}`);
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

// ─── Step 1: Build frontend ────────────────────────────────────────────────

const startedAt = performance.now();

if (only === "--addon-only") {
  // Only darwin-arm64 links DuckDB statically (Step 2); other targets have nothing to prebuild.
  if (target === "bun-darwin-arm64") {
    console.log(`  ${GREEN}✓${RESET} static duckdb.node: ${relative(REPO_ROOT, await buildStaticDuckDBAddon())}`);
  }
  process.exit(0);
}

if (only === "--compile-only") {
  if (!existsSync(FRONTEND_DIST)) throw new Error(`${FRONTEND_DIST} not found. Run \`vp run build\`.`);
} else {
  console.log(`\n  ${BOLD}Step 1:${RESET} Building frontend (Bun.build)...\n`);
  await buildFrontendWithBun();
  console.log(`  ${GREEN}✓${RESET} Frontend built`);
  if (only === "--frontend-only") process.exit(0);
}

// ─── Step 2: Generate embedded-asset manifests ─────────────────────────────
//
// We can't pass the JS bundle as an entrypoint to `bun build --compile`
// (it would try to parse it: top-level await in the minified output
// fails). Instead, generate TS modules with `import ... with { type: "file" }`
// declarations. Bun embeds those files into $bunfs at compile time, and
// the imports return path strings that work in both dev and compiled mode.

console.log(`\n  ${BOLD}Step 2:${RESET} Generating embedded-asset manifests...`);

const glob = new Bun.Glob("**/*");
const assetPaths: string[] = [];
for await (const path of glob.scan({ cwd: FRONTEND_DIST, onlyFiles: true })) {
  // Keys are looked up by URL pathname in server/static.ts, which rejects any
  // key containing a backslash as path traversal. Windows glob output would
  // otherwise make every nested asset unreachable.
  assetPaths.push(path.replaceAll("\\", "/"));
}

const frontendManifestLines: string[] = [
  "// AUTO-GENERATED by scripts/build.ts: do not edit.",
  "// Maps frontend asset relative paths to their resolved file paths.",
  "// In dev mode paths point at dist/frontend/; in compiled binaries they",
  '// resolve to $bunfs/ entries embedded via `with { type: "file" }`.',
  "",
];
for (let i = 0; i < assetPaths.length; i++) {
  const assetPath = resolve(FRONTEND_DIST, assetPaths[i]);
  const relativePath = relative(dirname(FRONTEND_MANIFEST_PATH), assetPath).replaceAll("\\", "/");
  const specifier = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
  frontendManifestLines.push(`import _${i} from "${specifier}" with { type: "file" };`);
}
frontendManifestLines.push("");
frontendManifestLines.push("export const EMBEDDED_ASSETS: Record<string, string> = {");
for (let i = 0; i < assetPaths.length; i++) {
  frontendManifestLines.push(`    ${JSON.stringify(assetPaths[i])}: _${i},`);
}
frontendManifestLines.push("};");
frontendManifestLines.push("");

const outfile = resolve(OUT_DIR, target.startsWith("bun-windows-") ? "ndea.exe" : "ndea");
let compileExit = 1;
try {
  await Bun.write(FRONTEND_MANIFEST_PATH, frontendManifestLines.join("\n"));
  console.log(`  ${GREEN}✓${RESET} ${assetPaths.length} frontend assets manifested`);

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

  // ─── Step 3: Compile binary ────────────────────────────────────────────────

  console.log(`\n  ${BOLD}Step 3:${RESET} Compiling binary for ${target}...\n`);

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
    compile: { target: target as Bun.Build.CompileTarget, outfile },
    // `bytecode` omitted: the CLI entry uses top-level await, which Bun's
    // bytecode pre-compiler rejects.
    minify: true,
    external: DUCKDB_PLATFORM_EXTERNALS,
    plugins: staticAddon
      ? [
          {
            name: "static-duckdb-addon",
            setup(build) {
              const filter = new RegExp(`^@duckdb/node-bindings-${matchingPlatform}/duckdb\\.node$`);
              build.onResolve({ filter }, () => ({ path: staticAddon }));
            },
          },
        ]
      : [],
    throw: false,
  });
  for (const log of result.logs) console.error(log);
  compileExit = result.success ? 0 : 1;
} finally {
  await Promise.all([
    Bun.write(FRONTEND_MANIFEST_PATH, frontendManifestStub),
    Bun.write(LIBDUCKDB_STUB_PATH, libduckdbStub),
  ]);
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
