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
    description: "Server port (default: 5055)",
  }),
  defineFlag("host", { type: "string", description: "Server host (default: 127.0.0.1)" }),
  defineFlag("open", { type: "boolean", default: true, description: "Auto-open the browser" }),
  defineFlag("static", {
    type: "boolean",
    default: true,
    description: "Serve the frontend bundle (--no-static in dev mode)",
  }),
  defineFlag("obs-columns", { type: "string", description: "Comma-separated obs columns to include" }),
  defineFlag("preset", {
    type: "string",
    description: "Preset a new workspace file starts from: a built-in name (annotate) or a .json workspace document",
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
    static: boolean;
    "obs-columns"?: string;
    preset?: string;
    workspace?: string;
  };
}

export async function runView({ args, flags }: ViewInput): Promise<void> {
  const { paths } = args;
  if (paths.length === 0) {
    console.error("Error: at least one path is required.\n");
    console.error("Run 'ndea view --help' for usage.");
    process.exit(1);
  }

  const config = await resolveConfig(paths, {
    port: flags.port,
    host: flags.host,
    noOpen: !flags.open,
    noStatic: !flags.static,
    obsColumns: parseObsColumns(flags["obs-columns"]),
    preset: flags.preset,
    workspace: flags.workspace,
  });

  try {
    await startup(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nFatal error during startup: ${msg}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
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
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error loading config: ${msg}`);
      process.exit(1);
    }
  }

  try {
    for (const p of paths) validateZarrPath(p);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  return resolveLaunchConfig(pathsToConfig(paths), overrides);
}
