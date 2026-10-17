#!/usr/bin/env bun

/**
 * ndea CLI: nd-embedding-atlas viewer + self-updater, built on Crust.
 *
 * Subcommands:
 *   view       Open Zarr stores in the dashboard (default)
 *   update     Download a new release and switch the active symlink
 *   gc         Prune old installed versions
 *   doctor     Diagnose the install (paths, symlink, versions)
 *   filter     Filter observations on a running server; prints JSON
 *   workspace  Read and patch a running server's workspace document
 *   mcp        Install, check, or remove ndea's MCP server in coding agents
 *   completion Print a bash, zsh, or fish completion script
 *
 * The root action is `view`: Crust routes a known subcommand first and
 * parses any other word as the root's positional paths, so
 *     ndea ./data.zarr
 *     ndea project.yaml --port 8080
 * open the dashboard.
 */

// Side-effect import: extracts embedded libduckdb (when bundled at build
// time) and dlopen's it with RTLD_GLOBAL BEFORE any duckdb-touching module
// loads. ES module post-order evaluation guarantees this runs ahead of
// `view.ts` → `startup.ts` → `server/store.ts` (the first place
// @duckdb/node-api is evaluated). No-op in dev mode.
// eslint-disable-next-line import/no-unassigned-import
import "./lib/preload-libduckdb.ts";

import { Crust } from "@crustjs/core";
import { completion, didYouMean, help, renderHelp, version } from "@crustjs/extensions";
import doctorCommand from "./commands/doctor.ts";
import filterCommand from "./commands/filter.ts";
import gcCommand from "./commands/gc.ts";
import mcpCommand from "./commands/mcp.ts";
import updateCommand from "./commands/update.ts";
import viewCommand, { runView, viewArgs, viewFlags } from "./commands/view.ts";
import workspaceCommand from "./commands/workspace.ts";
import { VERSION } from "./version.ts";

export const app = new Crust("ndea", {
  description:
    "Interactive browser-based dashboard linking AI embeddings to source 5D (TCZYX) image data.\n\n" +
    "Default (no subcommand) runs 'view': e.g. 'ndea ./data.zarr'.",
  version: VERSION,
})
  .args(...viewArgs)
  .flags(...viewFlags)
  .action((context) =>
    context.args.paths.length > 0 ? runView(context) : context.stdout(renderHelp(context.rootCommand)),
  )
  .add(viewCommand, updateCommand, gcCommand, doctorCommand, filterCommand, workspaceCommand, mcpCommand)
  .extend(version(undefined, { format: "plain" }), help(), completion(), didYouMean());

if (import.meta.main) await app.execute();
