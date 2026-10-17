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
import { stateDir } from "../lib/paths.ts";
import { server } from "../lib/server.ts";
import { PlainError } from "../lib/style.ts";

export default defineCommand(
  "status",
  { description: "Show the running server's status: datasets, embeddings, workspace, clients" },
  (command) =>
    command
      .provide(server())
      .flags(defineFlag("json", { type: "boolean", default: false, description: "Print one JSON snapshot and exit" }))
      .action(async ({ ctx, flags, stdout, signal }) => {
        const { origin } = await ctx.server;
        const token = await readFile(join(stateDir(), "mcp-token"), "utf8").then(
          (text) => text.trim(),
          () => "",
        );
        const fetchStatus = async (): Promise<{ body: string; status: RuntimeStatus }> => {
          let res: Response;
          try {
            res = await fetch(`${origin}/api/status`, { signal, headers: { authorization: `Bearer ${token}` } });
          } catch (err) {
            if (signal.aborted) throw err;
            throw new Error(
              `no ndea server at ${origin} (${err instanceof Error ? err.message : String(err)})\n` +
                "  start one with `ndea view <data>`, or pass --host/--port (NDEA_HOST/NDEA_PORT)",
              { cause: err },
            );
          }
          const body = await res.text();
          if (!res.ok) throw new PlainError(body);
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
