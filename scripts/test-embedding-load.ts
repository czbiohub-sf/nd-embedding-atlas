#!/usr/bin/env bun
/**
 * Test embedding loading: start backend, trigger X_phate load, poll until ready.
 */
import { spawn, sleep } from "bun";

const projectRoot = new URL("..", import.meta.url).pathname;
const server = spawn({
  cmd: [
    "bun",
    "run",
    "src/cli/index.ts",
    "../ome-atlas-test-data/infectomics/infectomics.yaml",
    "--no-open",
    "--no-static",
  ],
  cwd: projectRoot,
  stdout: "inherit",
  stderr: "inherit",
});

// Wait for backend
for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch("http://localhost:5055/data/metadata.json");
    if (r.ok) break;
  } catch {
    /* not ready */
  }
  await sleep(500);
}

console.log("\n=== Triggering X_phate load ===");
const load = await fetch("http://localhost:5055/api/embeddings/X_phate", { method: "POST" });
console.log("POST →", load.status, await load.json());

// Poll until ready
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  const status = await fetch("http://localhost:5055/api/embeddings/X_phate/status");
  const body = await status.json();
  console.log(`poll ${i}: ${JSON.stringify(body)}`);
  if (body.status === "ready") {
    console.log("\n=== Embedding loaded! Testing scatter positions ===");
    const scatter = await fetch(
      `http://localhost:5055/api/scatter-positions?embedding=X_phate&x_col=phate_0&y_col=phate_1`,
    );
    console.log(
      "scatter-positions →",
      scatter.status,
      scatter.headers.get("content-type"),
      "size:",
      (await scatter.arrayBuffer()).byteLength,
      "bytes",
    );
    break;
  }
  if (body.status === "error") {
    console.error("ERROR:", body.error);
    break;
  }
}

server.kill();
process.exit(0);
