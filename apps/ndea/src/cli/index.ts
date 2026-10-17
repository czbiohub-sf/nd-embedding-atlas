#!/usr/bin/env bun

/**
 * ndea CLI: nd-embedding-atlas viewer, server client, and self-updater, on Crust.
 *
 *   ndea [paths...]                        view (the root action)
 *   ndea view [paths...]                   open Zarr stores or a YAML project in the dashboard
 *   ndea workspace get|patch|result|query  talk to a running server; prints JSON
 *   ndea mcp install|check|uninstall       connect coding agents to the server's MCP endpoint
 *   ndea self update|doctor|prune          manage this install
 *   ndea completion <bash|zsh|fish>        print a shell completion script
 *   ndea man                               print the manual page (mdoc)
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

import { Crust, defineCommand } from "@crustjs/core";
import { completion, didYouMean, help, noColor, renderHelp, version } from "@crustjs/extensions";
import { renderManPageMdoc } from "@crustjs/man";
import mcpCommand from "./commands/mcp.ts";
import doctorCommand from "./commands/self-doctor.ts";
import pruneCommand from "./commands/self-prune.ts";
import updateCommand from "./commands/self-update.ts";
import viewCommand, { runView, viewArgs, viewFlags } from "./commands/view.ts";
import workspaceCommand from "./commands/workspace.ts";
import { errors } from "./lib/style.ts";
import { VERSION } from "./version.ts";

const selfCommand = defineCommand("self", { description: "Update, diagnose, or prune this ndea install" }, (command) =>
  command.add(updateCommand, doctorCommand, pruneCommand),
);

const manCommand = defineCommand(
  "man",
  { description: "Print the manual page (mdoc): `ndea man | man -l -`, or `| mandoc -a` on macOS" },
  (command) => command.action(({ rootCommand, stdout }) => stdout(renderManPageMdoc({ root: rootCommand }))),
);

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
  .add(viewCommand, workspaceCommand, mcpCommand, selfCommand, manCommand)
  .extend(noColor(), version(undefined, { format: "plain" }), help(), completion(), didYouMean(), errors);

if (import.meta.main) await app.execute();
