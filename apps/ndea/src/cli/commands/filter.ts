/**
 * `ndea filter`: run a typed filter clause against a running `ndea view`
 * server and print the matched observations as JSON.
 *
 * The server validates the clause and compiles it with the same compiler as
 * the Workspace `filter` node, so both select identical observations.
 */

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { parseJsonFlag, requestServer, serverOptions } from "../lib/server-request.ts";

export default defineCommand({
  name: "filter" as const,
  description: "Filter observations on a running ndea server; prints JSON",
  options: {
    where: option(z.string().optional(), {
      description: 'Filter clause JSON, e.g. \'{"op":"gt","column":"area","value":100}\' (default: all rows)',
    }),
    limit: option(z.coerce.number().int().min(0).max(1_000_000).default(1000), {
      description: "Maximum rows to return (count is always exact)",
    }),
    ...serverOptions,
  },
  async handler({ flags }) {
    const where = flags.where === undefined ? null : parseJsonFlag("where", flags.where);
    await requestServer(flags, "/api/filter", { method: "POST", body: { where, limit: flags.limit } });
  },
});
