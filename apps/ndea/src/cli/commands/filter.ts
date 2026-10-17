/**
 * `ndea filter`: run a typed filter clause against a running `ndea view`
 * server and print the matched observations as JSON.
 *
 * The server validates the clause and compiles it with the same compiler as
 * workspace data sources and filter scopes, so both select identical observations.
 */

import { defineCommand } from "@crustjs/core";
import { z } from "zod";
import { parseJsonFlag, requestServer, serverFlags } from "../lib/server-request.ts";

export default defineCommand(
  "filter",
  { description: "Filter observations on a running ndea server; prints JSON" },
  (command) =>
    command
      .flags(
        {
          name: "where",
          type: "string",
          description: 'Filter clause JSON, e.g. \'{"op":"gt","column":"area","value":100}\' (default: all rows)',
        },
        {
          name: "limit",
          type: "string",
          schema: z.coerce.number().int().min(0).max(1_000_000).default(1000),
          description: "Maximum rows to return (count is always exact)",
        },
        ...serverFlags,
      )
      .action(async ({ flags }) => {
        const where = flags.where === undefined ? null : parseJsonFlag("where", flags.where);
        await requestServer(flags, "/api/filter", { method: "POST", body: { where, limit: flags.limit } });
      }),
);
