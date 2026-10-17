/** GET /api/status: one snapshot of a running server, for `ndea status` and the in-process TUI. */

import { z } from "zod";
import { WorkspaceRevisionSchema } from "./workspace";

const count = z.number().int().nonnegative();

const DatasetStatusSchema = z.object({
  name: z.string(),
  format: z.enum(["anndata", "mudata"]),
  path: z.string(),
  observations: count,
  variables: count,
  obsColumns: count,
  modalities: z.array(z.object({ name: z.string(), observations: count, variables: count })).optional(),
  /** This dataset's obsm keys. */
  embeddings: z.array(z.string()),
  plate: z
    .object({
      path: z.string(),
      wells: count,
      channels: z.array(z.object({ name: z.string(), color: z.string() })), // color: "#RRGGBB"
    })
    .optional(),
  /** Size on disk; absent until the one background walk after startup finishes (or for remote stores). */
  bytes: count.optional(),
});

export const RuntimeStatusSchema = z.object({
  server: z.object({
    version: z.string(),
    url: z.string(),
    startedAt: z.string(), // ISO 8601
    rss: count, // bytes
    /** `cached`: DuckDB opened from the ingest cache; `fresh`: ingested and cached; `uncached`: in memory. */
    ingest: z.enum(["cached", "fresh", "uncached"]),
  }),
  datasets: z.array(DatasetStatusSchema),
  embeddings: z.object({
    available: z.array(z.string()),
    loading: z.array(z.string()),
    errors: z.record(z.string(), z.string()),
  }),
  workspace: z.object({
    path: z.string(),
    revision: count,
    /** The newest 50 revisions, newest first; `ops` is the op count. */
    recent: z.array(WorkspaceRevisionSchema.omit({ ops: true, baseRevision: true }).extend({ ops: count })),
  }),
  clients: z.object({
    browserSockets: count,
    mcpInFlight: count,
    agents: z.array(z.object({ agent: z.string(), lastSeen: z.string() })),
  }),
  /** The server's last 200 console lines, oldest first. */
  logs: z.array(z.object({ level: z.enum(["log", "warn", "error"]), text: z.string(), at: z.string() })),
});
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;
