#!/usr/bin/env bun
/**
 * Dev entry point — tiny wrapper that converts a positional dataset arg
 * into the NDEA_DATASET env var and delegates to `vp run --parallel dev:all`.
 *
 * Needed because vp's task runner forwards ADDITIONAL_ARGS to every task in
 * a `dependsOn` chain, and Vite interprets a positional path as a project
 * root. Routing the path through env avoids that cross-task contamination.
 *
 *   bun run dev ../data.zarr              → NDEA_DATASET=../data.zarr vp run ...
 *   NDEA_DATASET=... bun run dev          → env var passes through unchanged
 */

import { spawn } from "bun";

const [positional] = Bun.argv.slice(2);
const env: Record<string, string> = {
  ...process.env,
  NDEA_NO_STATIC: "1",
  NDEA_NO_OPEN: "1",
};
if (positional) env.NDEA_DATASET = positional;

const proc = spawn(["vp", "run", "--parallel", "dev:all"], {
  env,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const code = await proc.exited;
process.exit(code);
