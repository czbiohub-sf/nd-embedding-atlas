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

/**
 * GET /api/workspace. The server seeds a missing workspace file from its preset, so `document` is always set.
 * `name` is the workspace file stem, the `<name>` in `ndea://<name>/<element-id>` references.
 */
export const WorkspaceSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  document: z.unknown(),
  name: z.string(),
});
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;

/**
 * PATCH /api/workspace. Ops apply to the document at `baseRevision`.
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

/**
 * Who committed a revision, stamped by the server from the transport (never
 * from the request body). `system` is the seed or baseline; `agent` is the
 * MCP client's `X-Ndea-Agent` header. Provenance, not authorization.
 */
export const WorkspaceActorSchema = z.object({
  kind: z.enum(["system", "browser", "cli", "mcp"]),
  agent: z
    .string()
    .regex(/^[\w.-]{1,64}$/)
    .optional(),
});
export type WorkspaceActor = z.infer<typeof WorkspaceActorSchema>;

/** One committed revision: the ops that turned `baseRevision` into `revision`. */
export const WorkspaceRevisionSchema = z.object({
  revision: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(),
  actor: WorkspaceActorSchema,
  ops: z.array(JsonPatchOpSchema),
  committedAt: z.string(),
  restoredFrom: z.number().int().positive().optional(),
});
export type WorkspaceRevision = z.infer<typeof WorkspaceRevisionSchema>;

/** `workspace/watch` push: the committed revision plus the writer's echo token. */
export const WorkspaceChangeSchema = WorkspaceRevisionSchema.extend({ clientId: z.string().optional() });
export type WorkspaceChange = z.infer<typeof WorkspaceChangeSchema>;

/** GET /api/workspace/history?before=<revision>&limit=<1..500, default 50>: newest first. */
export const WorkspaceHistorySchema = z.object({ revisions: z.array(WorkspaceRevisionSchema) });
export type WorkspaceHistory = z.infer<typeof WorkspaceHistorySchema>;

/**
 * POST /api/workspace/restore: commit the document at `revision` as a new
 * revision against `baseRevision`. Responses match PATCH (200, 409, 400).
 */
export const WorkspaceRestoreBodySchema = z.object({
  revision: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(),
  clientId: z.string().min(1).max(128).optional(),
});
export type WorkspaceRestoreBody = z.infer<typeof WorkspaceRestoreBodySchema>;
