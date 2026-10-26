/**
 * `ndea status`: the running server's live status screen, polled from
 * `/api/status` with the MCP bearer token. `--json` (or a non-TTY stdout)
 * prints one snapshot and exits.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand, defineFlag } from "@crustjs/core";
import { RuntimeStatusSchema } from "@ndea/protocol";
import type { RuntimeStatus } from "@ndea/protocol";
import { stateDir } from "../../env/paths.ts";
import { server } from "../lib/server.ts";

export default defineCommand(
  "status",
  { description: "Show the running server's status: datasets, workspace activity, logs" },
  (command) =>
    command
      .provide(server())
      .flags(defineFlag("json", { type: "boolean", default: false, description: "Print one JSON snapshot and exit" }))
      .action(async ({ ctx, flags, stdout }) => {
        const { text } = await ctx.server;
        const token = await readFile(join(stateDir(), "mcp-token"), "utf8").then(
          (contents) => contents.trim(),
          () => "",
        );
        const fetchStatus = async (): Promise<{ body: string; status: RuntimeStatus }> => {
          const body = await text("/api/status", { authorization: `Bearer ${token}` });
          return { body, status: RuntimeStatusSchema.parse(JSON.parse(body)) };
        };

        const first = await fetchStatus();
        if (flags.json) return stdout(first.body);
        // Lazy: OpenTUI loads its native library on import; every other command skips it.
        const { renderStatus, runStatusTui } = await import("../tui.ts");
        if (!process.stdin.isTTY || !process.stdout.isTTY) return stdout(renderStatus(first.status));
        await runStatusTui(async () => (await fetchStatus()).status);
      }),
);
