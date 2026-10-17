#!/usr/bin/env bun
/**
 * `vp run bytecode-order`: re-record the bytecode-order profiles (bytecode-order/*.order) that build.ts lays the
 * binary's bytecode out by, then `vp run build` again. Each profile is one way users start ndea: `view` until
 * Ready, `--help`, `--version`, and `workspace get` against that server. Needs dist/ndea, the
 * ../ome-atlas-test-data checkout beside the repo, and a free port 5099. Re-record when
 * `bytecodeOrderStats()` (bun:jsc) shows a growing `cold` share.
 */

import { tmpdir } from "node:os";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const bin = resolve(REPO_ROOT, "dist/ndea");
const dataset = resolve(REPO_ROOT, "../ome-atlas-test-data/infectomics/infectomics.yaml");
const port = "5099";
const record = (name: string) => ({
  ...process.env,
  BUN_BYTECODE_ORDER_OUT: resolve(import.meta.dir, "bytecode-order", `${name}.order`),
});

const view = Bun.spawn(
  [bin, dataset, "--no-open", "--port", port, "--workspace", resolve(tmpdir(), "ndea-bytecode-order.json")],
  { stdout: "pipe", env: record("view") },
);
let output = "";
for await (const chunk of view.stdout.pipeThrough(new TextDecoderStream())) {
  output += chunk;
  if (output.includes("Ready in")) break;
}

const commands: [string, string[]][] = [
  ["help", ["--help"]],
  ["version", ["--version"]],
  ["workspace-get", ["workspace", "get", "--port", port]],
];
try {
  for (const [name, argv] of commands) {
    const run = Bun.spawn([bin, ...argv], { stdout: "ignore", env: record(name) });
    if ((await run.exited) !== 0) throw new Error(`ndea ${argv.join(" ")} failed`);
  }
} finally {
  // The profile is written on exit; `view` exits through its SIGINT shutdown.
  view.kill("SIGINT");
  await view.exited;
}
