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

// Start backend in API-only mode (Vite handles the frontend, so the backend
// should neither serve static files nor auto-open a browser window).
// `--hot` reloads on server source changes without dropping the port.
// citty silently drops `--no-*` CLI flags, so we pass both suppressors as
// env vars. The --no-static CLI flag was observed to be ignored; NDEA_NO_STATIC
// is the reliable path.
const backend = spawn({
  cmd: ["bun", "--hot", "run", "src/cli/index.ts", ...args],
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, NDEA_NO_OPEN: "1", NDEA_NO_STATIC: "1" },
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

// Start frontend dev server (root cwd — vite.config.ts is at repo root).
const frontend = spawn({
  cmd: ["bunx", "vp", "dev"],
  stdout: "inherit",
  stderr: "inherit",
});

// Auto-open the Vite dev URL once it's serving. Mirrors the compiled
// binary's auto-open behavior so `vp run dev` isn't a blank terminal.
// Honors `--no-open` when passed through the dev args.
if (!args.includes("--no-open")) {
  void (async () => {
    const frontendUrl = "http://localhost:5173";
    const openStart = Date.now();
    while (Date.now() - openStart < 30_000) {
      try {
        const res = await fetch(frontendUrl);
        if (res.ok) {
          const opener = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
          if (opener) spawn({ cmd: [opener, frontendUrl] });
          return;
        }
      } catch {
        /* Vite not ready yet */
      }
      await sleep(200);
    }
  })();
}

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
