/**
 * Workspace document transport. The server owns one revisioned document;
 * every writer sends RFC 6902 operations against the revision it last saw.
 * The document body is validated by the app, so it is opaque here.
 */

import { z } from "zod";

const PointerSchema = z.string().regex(/^(\/([^~/]|~[01])*)*$/, "Expected an RFC 6901 JSON Pointer");

/** One RFC 6902 operation. */
export const JsonPatchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: PointerSchema, value: z.unknown() }).strict(),
  z.object({ op: z.literal("remove"), path: PointerSchema }).strict(),
  z.object({ op: z.literal("replace"), path: PointerSchema, value: z.unknown() }).strict(),
  z.object({ op: z.literal("move"), from: PointerSchema, path: PointerSchema }).strict(),
  z.object({ op: z.literal("copy"), from: PointerSchema, path: PointerSchema }).strict(),
  z.object({ op: z.literal("test"), path: PointerSchema, value: z.unknown() }).strict(),
]);
export type JsonPatchOp = z.infer<typeof JsonPatchOpSchema>;

/** GET /api/workspace. `document: null` until the first write (revision 0). */
export const WorkspaceSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  document: z.unknown(),
});
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;

/**
 * PATCH /api/workspace. Ops apply to the document at `baseRevision`; at
 * revision 0 the only valid patch is `[{ op: "add", path: "", value: doc }]`.
 * `clientId` lets a client ignore its own echo on `workspace/watch`.
 */
export const WorkspacePatchBodySchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  ops: z.array(JsonPatchOpSchema).min(1).max(10_000),
  clientId: z.string().min(1).max(128).optional(),
});
export type WorkspacePatchBody = z.infer<typeof WorkspacePatchBodySchema>;

/** 200 response to PATCH /api/workspace. */
export const WorkspacePatchAcceptedSchema = z.object({ revision: z.number().int().positive() });
export type WorkspacePatchAccepted = z.infer<typeof WorkspacePatchAcceptedSchema>;

/** 409 response: `baseRevision` was stale. Rebase onto this snapshot and resend. */
export const WorkspaceConflictSchema = WorkspaceSnapshotSchema.extend({ error: z.literal("stale revision") });
export type WorkspaceConflict = z.infer<typeof WorkspaceConflictSchema>;

/** 400 response: RFC 9457 problem details with JSON Pointer issues. */
export const WorkspaceProblemSchema = z.object({
  type: z.literal("about:blank"),
  title: z.string(),
  status: z.literal(400),
  detail: z.string(),
  errors: z.array(z.object({ pointer: z.string(), detail: z.string() })),
});
export type WorkspaceProblem = z.infer<typeof WorkspaceProblemSchema>;

/** `workspace/watch` push: one accepted revision and the ops that produced it. */
export const WorkspaceChangeSchema = z.object({
  revision: z.number().int().positive(),
  ops: z.array(JsonPatchOpSchema),
  clientId: z.string().optional(),
});
export type WorkspaceChange = z.infer<typeof WorkspaceChangeSchema>;

const ObservationPageSchema = {
  count: z.number().int().nonnegative(),
  rows: z.array(z.object({ rowIndex: z.number().int().nonnegative(), datasetKey: z.string(), obsName: z.string() })),
  truncated: z.boolean(),
};

/**
 * GET /api/workspace/nodes/:id. The node's cooked output at `revision`,
 * evaluated from the document alone: per-tab state (lassos, focus, cache
 * pins) is not visible here. Predicates come with a bounded observation page.
 */
export const WorkspaceNodeResultSchema = z.object({
  revision: z.number().int().nonnegative(),
  nodeId: z.string(),
  status: z.enum(["resolved", "unresolved", "error"]),
  error: z.string().optional(),
  output: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("pred"), sql: z.string().nullable(), ...ObservationPageSchema }),
      z.object({ kind: z.literal("sel"), sql: z.string().nullable(), ...ObservationPageSchema }),
      z.object({ kind: z.literal("focus"), rowIndex: z.number().int().nonnegative().nullable() }),
    ])
    .optional(),
});
export type WorkspaceNodeResult = z.infer<typeof WorkspaceNodeResultSchema>;
