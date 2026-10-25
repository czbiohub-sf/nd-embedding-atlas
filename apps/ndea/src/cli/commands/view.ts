/**
 * `ndea view`: open Zarr stores and serve the dashboard.
 *
 * This is also the root action: `ndea ./data.zarr` runs it directly, because
 * Crust parses an unmatched first word as the root's positional argument.
 */

import { defineArg, defineCommand, defineFlag } from "@crustjs/core";
import { z } from "zod";
import { isYamlConfig, loadProjectConfig, pathsToConfig, resolveLaunchConfig } from "../config.ts";
import type { LaunchConfig } from "../config.ts";
import { validateZarrPath } from "../resolve.ts";
import { startup } from "../startup.ts";

export const viewArgs = [
  defineArg("paths", {
    type: "path",
    variadic: true,
    description: "Zarr stores, or one YAML project config",
  }),
] as const;

export const viewFlags = [
  defineFlag("port", {
    type: "string",
    schema: z.coerce.number().int().min(1).max(65535).optional(),
    env: { name: "PORT" },
    description: "Server port (default: 5055)",
  }),
  defineFlag("host", { type: "string", description: "Server host (default: 127.0.0.1)" }),
  defineFlag("open", { type: "boolean", default: true, description: "Auto-open the browser" }),
  defineFlag("dev", {
    type: "boolean",
    default: false,
    description: "Serve the frontend source with Bun's dev server and HMR (source checkout only)",
  }),
  defineFlag("tui", {
    type: "boolean",
    default: true,
    description: "Show the live status screen in a terminal (--no-tui keeps log output)",
  }),
  defineFlag("obs-columns", { type: "string", description: "Comma-separated obs columns to include" }),
  defineFlag("preset", {
    type: "string",
    description: "Preset a new workspace file starts from: a built-in name (exploration) or a .json workspace document",
  }),
  defineFlag("workspace", {
    type: "string",
    description: "Workspace document file (default: ~/.ndea/workspaces/<datasets>.json)",
  }),
] as const;

interface ViewInput {
  args: { paths: string[] };
  flags: {
    port?: number;
    host?: string;
    open: boolean;
    dev: boolean;
    tui: boolean;
    "obs-columns"?: string;
    preset?: string;
    workspace?: string;
  };
  signal: AbortSignal;
}

export async function runView({ args, flags, signal }: ViewInput): Promise<void> {
  const { paths } = args;
  if (paths.length === 0) throw new Error("at least one path is required\nrun `ndea view --help` for usage");

  const config = await resolveConfig(paths, {
    port: flags.port,
    host: flags.host,
    noOpen: !flags.open,
    dev: flags.dev,
    tui: flags.tui && process.stdin.isTTY && process.stdout.isTTY,
    obsColumns: parseObsColumns(flags["obs-columns"]),
    preset: flags.preset,
    workspace: flags.workspace,
  });

  // Ingest does not poll the signal, so Ctrl-C during startup exits here (130).
  // Deferred a tick so the spinner's own SIGINT listener restores the cursor
  // first. After startup Crust drops its SIGINT hook and the server's
  // graceful shutdown owns Ctrl-C.
  signal.addEventListener("abort", () => setImmediate(() => process.exit(130)), { once: true });
  await startup(config);
}

export default defineCommand(
  "view",
  { description: "Open one or more Zarr stores (or a YAML project config) in the dashboard" },
  (command) =>
    command
      .args(...viewArgs)
      .flags(...viewFlags)
      .action(runView),
);

// ─── Helpers ────────────────────────────────────────────────────────────────

type Overrides = Parameters<typeof resolveLaunchConfig>[1];

function parseObsColumns(raw: string | undefined): string[] | undefined {
  const cols = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return cols.length > 0 ? cols : undefined;
}

async function resolveConfig(paths: string[], overrides: Overrides): Promise<LaunchConfig> {
  if (paths.length === 1 && isYamlConfig(paths[0])) {
    try {
      const project = await loadProjectConfig(paths[0]);
      for (const ds of project.datasets) validateZarrPath(ds.path);
      return resolveLaunchConfig(project, overrides);
    } catch (err) {
      throw new Error(`could not load config: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }

  for (const p of paths) validateZarrPath(p);
  return resolveLaunchConfig(pathsToConfig(paths), overrides);
}
