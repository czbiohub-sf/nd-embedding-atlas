#!/usr/bin/env bun

/**
 * Build nd-embedding-atlas binary for all supported platforms.
 *
 * NOTE: Cross-compilation will NOT include native .node addons (duckdb).
 * Each platform needs its own CI build for a fully functional binary.
 * This script is mainly useful for testing the compilation pipeline.
 *
 * Usage:
 *   bun run scripts/build-all.ts
 *   bun run scripts/build-all.ts --skip-frontend   # reuse existing dist/frontend
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── Args ──────────────────────────────────────────────────────────────────

const skipFrontend = Bun.argv.includes("--skip-frontend");

const ROOT = resolve(import.meta.dir, "..");
const FRONTEND_DIST = resolve(ROOT, "dist/frontend");
const OUT_DIR = resolve(ROOT, "dist");

// ─── ANSI helpers ──────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

// ─── Targets ───────────────────────────────────────────────────────────────

const TARGETS = [
  { target: "bun-darwin-arm64", suffix: "darwin-arm64", label: "macOS Apple Silicon" },
  { target: "bun-darwin-x64", suffix: "darwin-x64", label: "macOS Intel" },
  { target: "bun-linux-x64", suffix: "linux-x64", label: "Linux x64" },
  { target: "bun-linux-arm64", suffix: "linux-arm64", label: "Linux ARM64" },
] as const;

// ─── Step 1: Build frontend (once) ─────────────────────────────────────────

if (!skipFrontend) {
  console.log(`\n  ${BOLD}Building frontend...${RESET}\n`);
  const proc = Bun.spawn(["vp", "build"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`\n  ${RED}Frontend build failed${RESET}`);
    process.exit(1);
  }
}

if (!existsSync(FRONTEND_DIST)) {
  console.error(`\n  ${RED}Error:${RESET} dist/frontend/ not found.`);
  process.exit(1);
}

// ─── Step 2: Enumerate frontend assets ─────────────────────────────────────

const glob = new Bun.Glob("**/*");
const frontendFiles: string[] = [];
for await (const path of glob.scan({ cwd: FRONTEND_DIST, onlyFiles: true })) {
  frontendFiles.push(`dist/frontend/${path}`);
}

console.log(`  ${DIM}${frontendFiles.length} frontend files to embed${RESET}\n`);

// ─── Step 3: Build each target ─────────────────────────────────────────────

console.log(`  ${BOLD}Building for ${TARGETS.length} platforms...${RESET}\n`);

const results: { target: string; label: string; success: boolean; sizeMB?: string }[] = [];

for (const { target, suffix, label } of TARGETS) {
  const outfile = resolve(OUT_DIR, `ndea-${suffix}`);
  console.log(`  ${DIM}${label} (${target})...${RESET}`);

  const compileArgs = [
    "bun",
    "build",
    "./src/cli/index.ts",
    "--compile",
    `--target=${target}`,
    `--outfile=${outfile}`,
    // See scripts/build.ts: --bytecode incompatible with @opentui/core TLA.
    "--minify",
    ...frontendFiles,
  ];

  const proc = Bun.spawn(compileArgs, {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  if (exitCode === 0) {
    const sizeMB = (Bun.file(outfile).size / 1024 / 1024).toFixed(1);
    results.push({ target, label, success: true, sizeMB });
    console.log(`    ${GREEN}✓${RESET} ${outfile} (${sizeMB} MB)`);
  } else {
    const stderr = await new Response(proc.stderr).text();
    results.push({ target, label, success: false });
    console.log(`    ${RED}✗${RESET} Failed`);
    if (stderr.trim()) {
      console.log(`      ${DIM}${stderr.trim()}${RESET}`);
    }
  }
}

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(`\n  ${BOLD}Summary:${RESET}`);
for (const r of results) {
  const icon = r.success ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  const size = r.sizeMB ? ` (${r.sizeMB} MB)` : "";
  console.log(`    ${icon} ${r.label}${size}`);
}

const failures = results.filter((r) => !r.success);
if (failures.length > 0) {
  console.log(
    `\n  ${YELLOW}⚠${RESET}  ${failures.length} target(s) failed. Native addons (duckdb) require per-platform CI builds.`,
  );
}

console.log();
