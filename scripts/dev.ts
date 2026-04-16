#!/usr/bin/env bun
/**
 * Dev mode: start backend + frontend concurrently.
 *
 * Usage:
 *   vp run dev <path...>
 *   vp run dev config.yaml
 *   vp run dev ../data.zarr --port 8080
 */

import { spawn, sleep } from "bun";

const args = process.argv.slice(2);

if (args.length === 0) {
    console.error("Usage: vp run dev <path.zarr | config.yaml> [--port N] [--host H]");
    process.exit(1);
}

// Start backend with --no-static --no-open (frontend dev server handles both)
const backend = spawn({
    cmd: ["bun", "run", "src/cli/index.ts", ...args, "--no-static", "--no-open"],
    stdout: "inherit",
    stderr: "inherit",
});

// Parse port from args (default 5055)
let port = 5055;
const portIdx = args.indexOf("--port");
if (portIdx !== -1 && args[portIdx + 1]) {
    port = Number(args[portIdx + 1]);
}

// Wait for backend to be ready
const maxWait = 30_000;
const start = Date.now();
let ready = false;

while (Date.now() - start < maxWait) {
    try {
        const res = await fetch(`http://localhost:${port}/data/metadata.json`);
        if (res.ok) {
            ready = true;
            break;
        }
    } catch {
        // not ready yet
    }
    await sleep(200);
}

if (!ready) {
    console.error("\n  Backend did not start within 30s. Check errors above.");
    backend.kill();
    process.exit(1);
}

// Start frontend dev server
const frontend = spawn({
    cmd: ["vp", "dev"],
    cwd: "frontend",
    stdout: "inherit",
    stderr: "inherit",
});

// Forward signals to both processes
const shutdown = () => {
    frontend.kill();
    backend.kill();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Wait for either to exit
await Promise.race([backend.exited, frontend.exited]);
shutdown();
