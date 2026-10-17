/**
 * `ndea workspace`: read and edit the running server's workspace document.
 *
 *   ndea workspace get                            → { revision, document }
 *   ndea workspace patch --revision N --ops '[…]' → { revision } (RFC 6902 ops)
 *   ndea workspace result <element>               → { revision, predicate, count } the element shows
 *   ndea workspace result --data <name>           → { revision, predicate, count } the data source selects
 *
 * `patch` goes through the same validated path as the browser: a stale
 * revision exits 1 with the current snapshot; an invalid result exits 1 with
 * RFC 9457 problem details whose `errors[].pointer` locate each issue.
 */

import { defineCommand } from "@crustjs/core";
import { z } from "zod";
import { parseJsonFlag, requestServer, serverFlags } from "../lib/server-request.ts";

const getCommand = defineCommand(
  "get",
  { description: "Print the current workspace revision and document as JSON" },
  (command) =>
    command.flags(...serverFlags).action(async ({ flags }) => {
      await requestServer(flags, "/api/workspace");
    }),
);

const patchCommand = defineCommand(
  "patch",
  { description: "Apply RFC 6902 ops to the workspace at an expected revision" },
  (command) =>
    command
      .flags(
        {
          name: "revision",
          type: "string",
          schema: z.coerce.number().int().nonnegative(),
          description: "Revision the ops were written against (from `ndea workspace get`)",
        },
        {
          name: "ops",
          type: "string",
          required: true,
          description:
            'JSON array of RFC 6902 ops, e.g. \'[{"op":"add","path":"/data/infected","value":{"sql":"area > 20"}}]\'',
        },
        ...serverFlags,
      )
      .action(async ({ flags }) => {
        const ops = parseJsonFlag("ops", flags.ops);
        await requestServer(flags, "/api/workspace", {
          method: "PATCH",
          body: { baseRevision: flags.revision, ops },
        });
      }),
);

const resultCommand = defineCommand(
  "result",
  { description: "Print what one dashboard element shows, or one data source selects, as JSON" },
  (command) =>
    command
      .args({ name: "element", type: "string", description: "Element id (see `ndea workspace get`)" })
      .flags(
        { name: "data", type: "string", description: "Evaluate this data source instead of an element" },
        ...serverFlags,
      )
      .action(async ({ args, flags }) => {
        if (flags.data) {
          await requestServer(flags, `/api/workspace/data/${encodeURIComponent(flags.data)}`);
          return;
        }
        if (!args.element) {
          console.error(
            "Error: pass an element id (`ndea workspace result count-1`) or --data <name>; see `ndea workspace get`.",
          );
          process.exit(1);
        }
        await requestServer(flags, `/api/workspace/elements/${encodeURIComponent(args.element)}`);
      }),
);

export default defineCommand(
  "workspace",
  { description: "Read and edit the running server's workspace document" },
  (command) => command.add(getCommand, patchCommand, resultCommand),
);
