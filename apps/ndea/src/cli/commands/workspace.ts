/**
 * `ndea workspace`: read and edit the running server's workspace document.
 *
 *   ndea workspace get                          → { revision, document }
 *   ndea workspace patch --revision N --ops '[…]' → { revision } (RFC 6902 ops)
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
      description: 'JSON array of RFC 6902 ops, e.g. \'[{"op":"replace","path":"/stripH","value":320}]\'',
    }),
    ...serverOptions,
  },
  async handler({ flags }) {
    const ops = parseJsonFlag("ops", flags.ops);
    await requestServer(flags, "/api/workspace", { method: "PATCH", body: { baseRevision: flags.revision, ops } });
  },
});

export default defineGroup({
  name: "workspace" as const,
  description: "Read and edit the running server's workspace document",
  commands: [getCommand, patchCommand],
});
