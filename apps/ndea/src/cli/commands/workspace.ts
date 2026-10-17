/**
 * `ndea workspace`: read, edit, and query the running server's workspace.
 *
 *   ndea workspace get                            → { revision, document }
 *   ndea workspace patch --revision N --ops '[…]' → { revision } (RFC 6902 ops)
 *   ndea workspace history [--limit N]            → { revisions } newest first: actor, ops, time
 *   ndea workspace restore <revision> [--base N]  → { revision } (the earlier document as a new revision)
 *   ndea workspace result <element>               → { revision, predicate, count } the element shows
 *   ndea workspace result --data <name>           → { revision, predicate, count } the data source selects
 *   ndea workspace query --where '{…}'            → { sql, count, rows, truncated } the clause selects
 *
 * `patch` and `restore` go through the same validated path as the browser,
 * stamped `cli` in history: a stale revision exits 1 with the current
 * snapshot; an invalid result exits 1 with RFC 9457 problem details whose
 * `errors[].pointer` locate each issue.
 * `query` compiles its clause with the same compiler as data sources and
 * filter scopes, so both select identical observations.
 */

import { defineCommand } from "@crustjs/core";
import { WorkspaceSnapshotSchema } from "@ndea/protocol";
import { z } from "zod";
import { server } from "../lib/server.ts";

const getCommand = defineCommand(
  "get",
  { description: "Print the current workspace revision and document as JSON" },
  (command) =>
    command.use(server).action(async ({ ctx }) => {
      await (await ctx.server).request("/api/workspace");
    }),
);

const patchCommand = defineCommand(
  "patch",
  { description: "Apply RFC 6902 ops to the workspace at an expected revision" },
  (command) =>
    command
      .use(server)
      .flags(
        {
          name: "revision",
          type: "string",
          schema: z.coerce.number().int().nonnegative(),
          description: "Revision the ops were written against (from `ndea workspace get`)",
        },
        {
          name: "ops",
          type: "json",
          required: true,
          description:
            'JSON array of RFC 6902 ops, e.g. \'[{"op":"add","path":"/data/infected","value":{"sql":"area > 20"}}]\'',
        },
      )
      .action(async ({ ctx, flags }) => {
        await (
          await ctx.server
        ).request("/api/workspace", {
          method: "PATCH",
          body: { baseRevision: flags.revision, ops: flags.ops },
        });
      }),
);

const historyCommand = defineCommand(
  "history",
  { description: "Print recent workspace revisions, newest first, with who wrote each" },
  (command) =>
    command
      .use(server)
      .flags({
        name: "limit",
        type: "string",
        schema: z.coerce.number().int().min(1).max(500).default(50),
        description: "Revisions to list (default: 50)",
      })
      .action(async ({ ctx, flags }) => {
        await (await ctx.server).request(`/api/workspace/history?limit=${flags.limit}`);
      }),
);

const restoreCommand = defineCommand(
  "restore",
  { description: "Bring an earlier revision's document back as a new revision" },
  (command) =>
    command
      .use(server)
      .args({ name: "revision", type: "number", required: true, description: "Revision to restore (see history)" })
      .flags({
        name: "base",
        type: "string",
        schema: z.coerce.number().int().nonnegative().optional(),
        description: "Apply only if the workspace is still at this revision (default: the current one)",
      })
      .action(async ({ ctx, args, flags }) => {
        const client = await ctx.server;
        const base = flags.base ?? (await client.json("/api/workspace", WorkspaceSnapshotSchema)).revision;
        await client.request("/api/workspace/restore", {
          method: "POST",
          body: { revision: args.revision, baseRevision: base },
        });
      }),
);

const resultCommand = defineCommand(
  "result",
  { description: "Print what one dashboard element shows, or one data source selects, as JSON" },
  (command) =>
    command
      .use(server)
      .args({ name: "element", type: "string", description: "Element id (see `ndea workspace get`)" })
      .flags({ name: "data", type: "string", description: "Evaluate this data source instead of an element" })
      .action(async ({ ctx, args, flags }) => {
        if (!flags.data && !args.element) {
          throw new Error(
            "pass an element id (`ndea workspace result count-1`) or --data <name>; see `ndea workspace get`",
          );
        }
        const path = flags.data
          ? `/api/workspace/data/${encodeURIComponent(flags.data)}`
          : `/api/workspace/elements/${encodeURIComponent(args.element!)}`;
        await (await ctx.server).request(path);
      }),
);

const queryCommand = defineCommand(
  "query",
  { description: "Print the observations a filter clause selects, as JSON" },
  (command) =>
    command
      .use(server)
      .flags(
        {
          name: "where",
          type: "json",
          description: 'Filter clause JSON, e.g. \'{"op":"gt","column":"area","value":100}\' (default: all rows)',
        },
        {
          name: "limit",
          type: "string",
          schema: z.coerce.number().int().min(0).max(1_000_000).default(1000),
          description: "Maximum rows to return (count is always exact)",
        },
      )
      .action(async ({ ctx, flags }) => {
        await (
          await ctx.server
        ).request("/api/filter", {
          method: "POST",
          body: { where: flags.where ?? null, limit: flags.limit },
        });
      }),
);

export default defineCommand(
  "workspace",
  { description: "Read, edit, and query the running server's workspace document" },
  (command) =>
    command
      .provide(server())
      .add(getCommand, patchCommand, historyCommand, restoreCommand, resultCommand, queryCommand),
);
