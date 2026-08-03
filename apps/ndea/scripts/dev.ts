#!/usr/bin/env bun
/**
 * Dev entry point: starts the backend and Vite frontend together for one
 * positional dataset.
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
const BACKEND_HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/api/health`;
const RETRY_DELAY_MS = 50;

async function killPortHolder(port: number): Promise<void> {
  const lsof = spawn(["lsof", `-tiTCP:${port}`, "-sTCP:LISTEN"], { stdout: "pipe", stderr: "pipe" });
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

const args = Bun.argv.slice(2);
if (args.length !== 1) {
  console.error("Usage: vp run dev <dataset>");
  process.exit(1);
}

const appRoot = resolve(import.meta.dir, "..");
const backend = spawn(
  ["bun", "--hot", "run", "src/cli/index.ts", "view", resolve(args[0]), "--no-static", "--no-open"],
  {
    cwd: appRoot,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  },
);
const startup = await Promise.race([
  waitForBackend().then(() => ({ ready: true as const, code: 0 })),
  backend.exited.then((code) => ({ ready: false as const, code })),
]);
if (!startup.ready) process.exit(startup.code);

const frontend = spawn(["vp", "dev", "."], {
  cwd: appRoot,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const children = [backend, frontend];
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}

const code = await Promise.race(children.map((child) => child.exited));
for (const child of children) child.kill();
await Promise.all(children.map((child) => child.exited));
process.exit(code);

async function waitForBackend(): Promise<void> {
  while (true) {
    try {
      const response = await fetch(BACKEND_HEALTH_URL);
      if (response.ok) return;
    } catch {
      // Backend still loading dataset.
    }
    await Bun.sleep(RETRY_DELAY_MS);
  }
}
