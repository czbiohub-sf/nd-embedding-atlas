#!/usr/bin/env bun

/**
 * Build the nd-embedding-atlas single binary.
 *
 * Steps:
 *   1. Build frontend (Bun.build)
 *   2. Enumerate dist/frontend/** files for embedding
 *   3. Embed libduckdb manifest so the preloader can dlopen it at runtime
 *   4. Compile binary (bun build --compile)
 *
 * The `--compile` flag is only available via the Bun CLI, not the JS API,
 * so this script shells out to `bun build`.
 *
 * Usage:
 *   vp run build                                      # current platform
 *   vp run build bun-linux-x64                        # specific target
 *
 * Output: dist/ndea: single self-contained binary. Embeds libduckdb;
 * the preloader extracts it to ~/.cache/ndea/<version>/ at first run and
 * dlopens it before @duckdb/node-api evaluates. No sidecar file, no
 * wrapper script.
 */

import type { BunPlugin } from "bun";
import { existsSync, rmSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { COLUMN_WORKER_ENTRYPOINT } from "@ndea/zarr/build";
import { GENERATED_COMMANDS_ENTRYPOINT } from "../src/cli/lib/generated-commands-path.ts";
import { CROP_WORKER_ENTRYPOINT } from "../src/server/crop-worker-path.ts";

// ─── Args ──────────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
const targetArg = args.find((a) => !a.startsWith("--") || a.startsWith("--target="));
const target =
  (targetArg?.startsWith("--target=") ? targetArg.slice("--target=".length) : targetArg) ??
  `bun-${process.platform}-${process.arch}`;

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
  /** Native shared-library extension on the target platform. */
  dylibExt: "dylib" | "so";
}

const TARGET_TO_DUCKDB: Record<string, DuckDBTarget> = {
  "bun-darwin-arm64": { bindingsDir: "node-bindings-darwin-arm64", dylibExt: "dylib" },
  "bun-darwin-x64": { bindingsDir: "node-bindings-darwin-x64", dylibExt: "dylib" },
  "bun-linux-arm64": { bindingsDir: "node-bindings-linux-arm64", dylibExt: "so" },
  "bun-linux-x64": { bindingsDir: "node-bindings-linux-x64", dylibExt: "so" },
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
// Bundles the frontend with Bun's own bundler (replaced `vp build`/Vite) so the
// whole build runs on Bun. Tailwind v4 (bun-plugin-tailwind) and the TypeGPU
// `'use gpu'` transform (unplugin-typegpu/bun) run as Bun.build plugins. The
// output (dist/frontend/**) is what Step 2 globs, so the embed-manifest +
// --compile tail downstream is unchanged. Vite is now only used for `vp dev`.
async function buildFrontendWithBun(): Promise<void> {
  const tailwind = (await import("bun-plugin-tailwind")).default;
  const typegpu = (await import("unplugin-typegpu/bun")).default;

  // Vite's `?url` asset suffix (e.g. prql.ts's `prql_js_bg.wasm?url`) has no
  // Bun.build equivalent: strip it and resolve the bare specifier, then let the
  // `.wasm` file loader below emit it as an asset whose import returns the URL.
  // Vite handles `?url` natively in dev; this keeps the one source working in both.
  const urlAssetSuffix: BunPlugin = {
    name: "url-asset-suffix",
    setup(build) {
      build.onResolve({ filter: /\?url$/ }, (a) => ({
        path: Bun.resolveSync(a.path.replace(/\?url$/, ""), dirname(a.importer)),
      }));
    },
  };

  // Bun.build writes into outdir without clearing it: wipe any stale Vite
  // output first so the manifest globs only Bun's emitted files.
  rmSync(FRONTEND_DIST, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [resolve(APP_ROOT, "index.html")],
    outdir: FRONTEND_DIST,
    target: "browser",
    minify: true,
    // No sourcemaps: they'd be globbed into the embed manifest and bloat the
    // compiled binary by ~15MB (Vite emits none here either).
    sourcemap: "none",
    // ponytail: splitting disabled: with `splitting: true`, Bun.build emitted an
    // index.html whose entry chunk's import closure never reached the createRoot
    // chunk, so the compiled binary served a blank page (React never mounted). A
    // single self-contained bundle is fine for a locally-served single binary :
    // there's no network to amortize split chunks over. Re-enable if Bun fixes the
    // HTML-entry-under-splitting wiring.
    splitting: false,
    // `?url` imports (and any other large binary asset) emit as a hashed file
    // whose default export is the served URL: matching Vite's `?url` behavior.
    loader: { ".wasm": "file" },
    // The frontend reads `import.meta.env.PROD` (DashboardProvider): Vite
    // injects it; Bun does not, so define it for the production bundle.
    define: {
      "import.meta.env.PROD": "true",
      "import.meta.env.DEV": "false",
    },
    plugins: [tailwind, typegpu({}), urlAssetSuffix],
  });

  if (!result.success) {
    console.error(`\n  ${RED}Bun.build frontend failed:${RESET}`);
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

// ─── Step 1: Build frontend ────────────────────────────────────────────────

const startedAt = performance.now();

console.log(`\n  ${BOLD}Step 1:${RESET} Building frontend (Bun.build)...\n`);
await buildFrontendWithBun();
console.log(`  ${GREEN}✓${RESET} Frontend built`);

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
  assetPaths.push(path);
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

const outfile = resolve(OUT_DIR, "ndea");
let compileExit = 1;
try {
  await Bun.write(FRONTEND_MANIFEST_PATH, frontendManifestLines.join("\n"));
  console.log(`  ${GREEN}✓${RESET} ${assetPaths.length} frontend assets manifested`);

  // libduckdb embed manifest: overwrites the committed dev stub
  // (LIBDUCKDB_EMBEDDED_PATH = null) with a real `with { type: "file" }`
  // import for the build target's libduckdb. Restored in the finally block.
  const dylibAbsPath = resolve(
    APP_ROOT,
    "node_modules/@duckdb",
    duckdbTarget.bindingsDir,
    `libduckdb.${duckdbTarget.dylibExt}`,
  );
  if (!existsSync(dylibAbsPath)) {
    throw new Error(`${dylibAbsPath} not found. Run \`vp install\` first.`);
  }
  const dylibRelPath = relative(dirname(LIBDUCKDB_STUB_PATH), dylibAbsPath);
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

  // ─── Step 3: Compile binary ────────────────────────────────────────────────

  console.log(`\n  ${BOLD}Step 3:${RESET} Compiling binary for ${target}...\n`);

  // @duckdb/node-bindings/duckdb.js branches through every platform's
  // native addon via require(). Only the matching optional dep for the
  // build target is needed; everything else gets externalized so the
  // bundler doesn't try to resolve missing optional deps.
  //
  // The matching one is NOT externalized: bun build --compile embeds
  // duckdb.node into $bunfs/, where it's extracted to a temp path at
  // runtime and dlopen'd. libduckdb resolves via the preloader's
  // process-level dlopen, not via duckdb.node's rpath.
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
  const ADDITIONAL_ENTRYPOINTS = [COLUMN_WORKER_ENTRYPOINT, CROP_WORKER_ENTRYPOINT, GENERATED_COMMANDS_ENTRYPOINT];

  const compileArgs = [
    "bun",
    "build",
    "./apps/ndea/src/cli/index.ts",
    ...ADDITIONAL_ENTRYPOINTS,
    "--compile",
    `--target=${target}`,
    `--outfile=${outfile}`,
    // `--bytecode` omitted: @opentui/core (transitive via @bunli/runtime)
    // emits top-level await that Bun's bytecode pre-compiler rejects.
    "--minify",
    ...DUCKDB_PLATFORM_EXTERNALS.flatMap((m) => ["--external", m]),
  ];

  // Stream Bun's compile output but drop its `minify … (estimate)` line: the
  // savings estimate is noise next to the real binary size we print below.
  const compileProc = Bun.spawn(compileArgs, {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "inherit",
  });
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of compileProc.stdout) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) if (!line.includes("(estimate)")) process.stdout.write(`${line}\n`);
  }
  if (pending && !pending.includes("(estimate)")) process.stdout.write(`${pending}\n`);
  compileExit = await compileProc.exited;
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
