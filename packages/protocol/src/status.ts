/** GET /api/status: one snapshot of a running server, for `ndea status` and the in-process TUI. */

import { z } from "zod";
import { WorkspaceRevisionSchema } from "./workspace";

export const RuntimeStatusSchema = z.object({
  server: z.object({
    version: z.string(),
    url: z.string(),
    startedAt: z.string(), // ISO 8601
    rss: z.number().int().nonnegative(), // bytes
  }),
  datasets: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      observations: z.number().int().nonnegative(),
      variables: z.number().int().nonnegative().optional(),
    }),
  ),
  embeddings: z.object({
    available: z.array(z.string()),
    loading: z.array(z.string()),
    errors: z.record(z.string(), z.string()),
  }),
  workspace: z.object({
    path: z.string(),
    revision: z.number().int().nonnegative(),
    last: WorkspaceRevisionSchema.optional(),
  }),
  clients: z.object({
    browserSockets: z.number().int().nonnegative(),
    mcpInFlight: z.number().int().nonnegative(),
    agents: z.array(z.object({ agent: z.string(), lastSeen: z.string() })),
  }),
});
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;
