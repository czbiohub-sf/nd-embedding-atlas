#!/usr/bin/env bun

import { spawn } from "bun";
import { resolve } from "node:path";

const BACKEND_HEALTH_URL = "http://127.0.0.1:5055/api/health";
const RETRY_DELAY_MS = 50;

while (true) {
  try {
    const response = await fetch(BACKEND_HEALTH_URL);
    if (response.ok) break;
  } catch {
    // Backend still loading the dataset.
  }
  await Bun.sleep(RETRY_DELAY_MS);
}

const frontend = spawn(["vp", "dev", "."], {
  cwd: resolve(import.meta.dir, ".."),
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

process.exit(await frontend.exited);
