#!/usr/bin/env bun

/**
 * ndea CLI — nd-embedding-atlas viewer + self-updater.
 *
 * Subcommands:
 *   view       Open zarr stores in the dashboard (default)
 *   install    Stage B of the self-installer (called by install.sh)
 *   update     Stage a new release for next launch
 *   rollback   Restore the previous binary
 *
 * For backwards compatibility, invocations without a subcommand default to
 * `view`:
 *     ndea ./data.zarr
 *     ndea project.yaml --port 8080
 *
 * Subcommands lazy-load through dynamic `import()` so `ndea update` doesn't
 * pay the zarr-open / DuckDB cost, and vice versa.
 */

import { defineCommand, runMain } from "citty";
import { VERSION } from "./version.ts";

const DESCRIPTION = `Interactive browser-based dashboard linking AI embeddings to source 5D (TCZYX) image data.

Default (no subcommand) runs 'view' — e.g. 'ndea ./data.zarr'.`;

/** Names of subcommands that should NOT fall through to `view`. */
const KNOWN_SUBCOMMANDS = new Set(["view", "install", "update", "rollback"]);

const main = defineCommand({
  meta: {
    name: "ndea",
    version: VERSION,
    description: DESCRIPTION,
  },
  subCommands: {
    view: () => import("./commands/view.ts").then((m) => m.default),
    install: () => import("./commands/install.ts").then((m) => m.default),
    update: () => import("./commands/update.ts").then((m) => m.default),
    rollback: () => import("./commands/rollback.ts").then((m) => m.default),
  },
});

/**
 * Normalize rawArgs so `ndea ./data.zarr` routes to `view ./data.zarr`.
 *
 * Citty dispatches on the first positional token: if it's a known subcommand
 * we leave it alone; otherwise we prepend `view` so the dashboard opens with
 * the original arguments intact. `--help` / `--version` without a subcommand
 * stay at the root so citty's built-in usage/version output runs.
 */
function normalizeArgs(rawArgs: string[]): string[] {
  const firstPositional = rawArgs.find((a) => !a.startsWith("-"));
  if (firstPositional && !KNOWN_SUBCOMMANDS.has(firstPositional)) {
    return ["view", ...rawArgs];
  }
  return rawArgs;
}

void runMain(main, { rawArgs: normalizeArgs(process.argv.slice(2)) });
