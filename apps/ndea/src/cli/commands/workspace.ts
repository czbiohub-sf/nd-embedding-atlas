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

import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";
import { parseJsonFlag, requestServer, serverOptions } from "../lib/server-request.ts";

const getCommand = defineCommand({
  name: "get" as const,
  description: "Print the current workspace revision and document as JSON",
  options: serverOptions,
  async handler({ flags }) {
    await requestServer(flags, "/api/workspace");
  },
});

const patchCommand = defineCommand({
  name: "patch" as const,
  description: "Apply RFC 6902 ops to the workspace at an expected revision",
  options: {
    revision: option(z.coerce.number().int().nonnegative(), {
      description: "Revision the ops were written against (from `ndea workspace get`)",
    }),
    ops: option(z.string(), {
      description:
        'JSON array of RFC 6902 ops, e.g. \'[{"op":"add","path":"/data/infected","value":{"sql":"area > 20"}}]\'',
    }),
    ...serverOptions,
  },
  async handler({ flags }) {
    const ops = parseJsonFlag("ops", flags.ops);
    await requestServer(flags, "/api/workspace", { method: "PATCH", body: { baseRevision: flags.revision, ops } });
  },
});

const resultCommand = defineCommand({
  name: "result" as const,
  description: "Print what one dashboard element shows, or one data source selects, as JSON",
  options: {
    data: option(z.string().optional(), { description: "Evaluate this data source instead of an element" }),
    ...serverOptions,
  },
  async handler({ flags, positional }) {
    if (flags.data) {
      await requestServer(flags, `/api/workspace/data/${encodeURIComponent(flags.data)}`);
      return;
    }
    const element = positional[0];
    if (!element) {
      console.error(
        "Error: pass an element id (`ndea workspace result count-1`) or --data <name>; see `ndea workspace get`.",
      );
      process.exit(1);
    }
    await requestServer(flags, `/api/workspace/elements/${encodeURIComponent(element)}`);
  },
});

export default defineGroup({
  name: "workspace" as const,
  description: "Read and edit the running server's workspace document",
  commands: [getCommand, patchCommand, resultCommand],
});
