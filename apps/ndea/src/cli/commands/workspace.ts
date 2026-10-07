/**
 * `ndea workspace`: read and edit the running server's workspace document.
 *
 *   ndea workspace get                            → { revision, document }
 *   ndea workspace patch --revision N --ops '[…]' → { revision } (RFC 6902 ops)
 *   ndea workspace result <node> [--limit N]      → the node's evaluated output
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

const resultCommand = defineCommand({
  name: "result" as const,
  description: "Print one node's evaluated output at the current revision as JSON",
  options: {
    limit: option(z.coerce.number().int().min(0).max(1_000_000).default(100), {
      description: "Maximum observations to list (count is always exact)",
    }),
    ...serverOptions,
  },
  async handler({ flags, positional }) {
    const nodeId = positional[0];
    if (!nodeId) {
      console.error("Error: pass a node id, e.g. `ndea workspace result count-2` (ids: `ndea workspace get`).");
      process.exit(1);
    }
    await requestServer(flags, `/api/workspace/nodes/${encodeURIComponent(nodeId)}?limit=${flags.limit}`);
  },
});

export default defineGroup({
  name: "workspace" as const,
  description: "Read and edit the running server's workspace document",
  commands: [getCommand, patchCommand, resultCommand],
});
