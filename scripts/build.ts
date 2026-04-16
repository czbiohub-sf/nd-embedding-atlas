#!/usr/bin/env bun

/**
 * Build the nd-embedding-atlas single binary.
 *
 * Steps:
 *   1. Build frontend (vp build)
 *   2. Enumerate frontend/dist/** files for embedding
 *   3. Compile binary (bun build --compile) with embedded frontend assets
 *
 * The `--compile` flag is only available via the Bun CLI, not the JS API,
 * so this script shells out to `bun build`.
 *
 * Usage:
 *   bun run scripts/build.ts                          # current platform
 *   bun run scripts/build.ts bun-linux-x64            # specific target
 *   bun run scripts/build.ts --skip-frontend           # skip frontend build
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── Args ──────────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
const skipFrontend = args.includes("--skip-frontend");
const targetArg = args.find((a) => !a.startsWith("--"));
const target = targetArg ?? `bun-${process.platform}-${process.arch}`;

const ROOT = resolve(import.meta.dir, "..");
const FRONTEND_DIST = resolve(ROOT, "frontend/dist");
const OUT_DIR = resolve(ROOT, "dist");

// ─── ANSI helpers ──────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

// ─── Step 1: Build frontend ────────────────────────────────────────────────

if (!skipFrontend) {
    console.log(`\n  ${BOLD}Step 1:${RESET} Building frontend...\n`);
    const frontendProc = Bun.spawn(["vp", "build"], {
        cwd: resolve(ROOT, "frontend"),
        stdout: "inherit",
        stderr: "inherit",
    });
    const exitCode = await frontendProc.exited;
    if (exitCode !== 0) {
        console.error(`\n  ${RED}Frontend build failed with exit code ${exitCode}${RESET}`);
        process.exit(1);
    }
    console.log(`  ${GREEN}✓${RESET} Frontend built`);
} else {
    console.log(`\n  ${DIM}Skipping frontend build (--skip-frontend)${RESET}`);
}

// Verify frontend/dist exists
if (!existsSync(FRONTEND_DIST)) {
    console.error(`\n  ${RED}Error:${RESET} frontend/dist/ not found. Run without --skip-frontend.`);
    process.exit(1);
}

// ─── Step 2: Enumerate frontend assets ─────────────────────────────────────

console.log(`\n  ${BOLD}Step 2:${RESET} Enumerating frontend assets...`);

const glob = new Bun.Glob("**/*");
const frontendFiles: string[] = [];
for await (const path of glob.scan({ cwd: FRONTEND_DIST, onlyFiles: true })) {
    frontendFiles.push(`frontend/dist/${path}`);
}

console.log(`  ${GREEN}✓${RESET} ${frontendFiles.length} frontend files to embed`);

// ─── Step 3: Compile binary ────────────────────────────────────────────────

console.log(`\n  ${BOLD}Step 3:${RESET} Compiling binary for ${target}...\n`);

const outfile = resolve(OUT_DIR, "ndea");

const compileArgs = [
    "bun", "build",
    "./src/cli/index.ts",
    "--compile",
    `--target=${target}`,
    `--outfile=${outfile}`,
    "--bytecode",
    "--minify",
    // Frontend files are passed as additional entrypoints;
    // Bun embeds them into the binary under $bunfs/ paths.
    ...frontendFiles,
];

const compileProc = Bun.spawn(compileArgs, {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
});

const compileExit = await compileProc.exited;
if (compileExit !== 0) {
    console.error(`\n  ${RED}Compile failed with exit code ${compileExit}${RESET}`);
    process.exit(1);
}

// ─── Done ──────────────────────────────────────────────────────────────────

const stat = Bun.file(outfile);
const sizeMB = (stat.size / 1024 / 1024).toFixed(1);

console.log(`\n  ${GREEN}✓${RESET} Binary: ${BOLD}${outfile}${RESET} (${sizeMB} MB)`);
console.log(`  ${DIM}Target: ${target}${RESET}\n`);
