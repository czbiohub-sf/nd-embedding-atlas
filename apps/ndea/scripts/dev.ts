#!/usr/bin/env bun
/**
 * Dev entry point: tiny wrapper that converts a positional dataset arg
 * into the NDEA_DATASET env var and delegates to `vp run --parallel dev:all`.
 *
 * Needed because vp's task runner forwards ADDITIONAL_ARGS to every task in
 * a `dependsOn` chain, and Vite interprets a positional path as a project
 * root. Routing the path through env avoids that cross-task contamination.
 *
 *   vp run dev ../data.zarr               → NDEA_DATASET=../data.zarr vp run ...
 *   NDEA_DATASET=... vp run dev           → env var passes through unchanged
 *
 * Pre-flight: kill anything still bound to the backend port. vp's task
 * runner doesn't always propagate SIGINT cleanly to `bun --hot run` children,
 * so a Ctrl+C on a previous `vp run dev` can leave an orphan backend that
 * silently serves a stale dataset to your next `vp run dev`. We free the
 * port up front so the new backend always wins.
 */

import { spawn } from "bun";
import { resolve } from "node:path";

const BACKEND_PORT = 5055;

async function killPortHolder(port: number): Promise<void> {
  const lsof = spawn(["lsof", "-ti", `:${port}`], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(lsof.stdout).text();
  await lsof.exited;
  const pids = out
    .split(/\s+/)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (pids.length === 0) return;
  console.warn(`[dev] freeing port ${port} (orphan pid${pids.length > 1 ? "s" : ""}: ${pids.join(", ")})`);
  await spawn(["kill", "-9", ...pids.map(String)]).exited;
}

await killPortHolder(BACKEND_PORT);

const [positional] = Bun.argv.slice(2);
const env: Record<string, string> = {
  ...process.env,
  NDEA_NO_STATIC: "1",
  NDEA_NO_OPEN: "1",
};
if (positional) env.NDEA_DATASET = resolve(positional);

const proc = spawn(["vp", "run", "--parallel", "@ndea/app#dev:all"], {
  env,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const code = await proc.exited;
process.exit(code);
