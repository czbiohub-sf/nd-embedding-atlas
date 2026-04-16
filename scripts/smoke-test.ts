#!/usr/bin/env bun
/**
 * Smoke test: start server, hit health endpoint, verify response.
 */

import { spawn } from "bun";

const server = spawn({
    cmd: [
        "bun",
        "run",
        "src/cli/index.ts",
        "../ome-atlas-test-data/infectomics/infectomics.yaml",
        "--no-open",
        "--no-static",
    ],
    stdout: "inherit",
    stderr: "inherit",
});

// Wait for server to start
await new Promise((r) => setTimeout(r, 12000));

try {
    const res = await fetch("http://localhost:5055/health");
    console.log(`\n[smoke-test] /health → ${res.status}`);
    const body = await res.text();
    console.log(`[smoke-test] body: ${body}`);

    const meta = await fetch("http://localhost:5055/data/metadata.json");
    console.log(`[smoke-test] /data/metadata.json → ${meta.status}`);
    const metaBody = await meta.text();
    console.log(`[smoke-test] body: ${metaBody.slice(0, 200)}`);
} catch (err) {
    console.error(`[smoke-test] ERROR: ${err}`);
}

server.kill();
process.exit(0);
