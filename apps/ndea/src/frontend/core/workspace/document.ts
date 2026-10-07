/**
 * The workspace document: the server-owned, file-persisted projection of
 * `WorkspaceDocumentState`. Pure (Zod + SDK only) so the server and the
 * browser validate with the same schema.
 *
 * Session fields (selection, claim, subnet path) stay in the browser store
 * and never reach the document. Only the exact format version loads; there
 * are no migrations.
 */

import { isSemanticVersion, type JsonValue } from "@ndea/sdk";
import { applyPatch, type Operation } from "rfc6902";
import { z } from "zod";

import { parseWorkspaceNodeAssetRecords } from "../node-asset/schema";
import type { TreeNode } from "./stage/split-tree";
import type { WorkspaceDocumentState } from "./types";

export const WORKSPACE_FORMAT = "ndea.workspace";
export const WORKSPACE_FORMAT_VERSION = 1;

/** Editor-session state: selection, claim, subnet path, and canvas camera disposition. */
const SESSION_FIELDS = [
  "selectedNodeId",
  "selectedNodeIds",
  "selectedEdgeId",
  "claimed",
  "graphPath",
  "disposition",
] as const;
type SessionField = (typeof SESSION_FIELDS)[number];

export type WorkspaceDocument = Omit<WorkspaceDocumentState, SessionField>;
export type WorkspaceSession = Pick<WorkspaceDocumentState, SessionField>;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const exactRefSchema = z
  .object({
    nodeTypeId: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[.-][a-z0-9]+)*)*$/),
    nodeTypeVersion: z.string().refine(isSemanticVersion, "node type version must be semantic"),
  })
  .strict();
const configSnapshotSchema = z
  .object({
    version: z.number().int().nonnegative().refine(Number.isSafeInteger, "config version must be safe"),
    value: jsonValueSchema,
  })
  .strict();
const nodeSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .refine((id) => !id.includes("::asset::"), 'node id uses reserved runtime namespace "::asset::"'),
    definitionRef: exactRefSchema,
    label: z.string(),
    parent: z.string().nullable().optional(),
    stamp: z.number().optional(),
    config: configSnapshotSchema.optional(),
  })
  .strict();
const edgeSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    fromPort: z.string().min(1),
    to: z.string().min(1),
    toPort: z.string().min(1),
    kind: z.enum(["pred", "sel", "focus"]),
  })
  .strict();
const sizeSchema = z.object({ w: z.number(), h: z.number() }).strict();
const treeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.union([
    z.string(),
    z.object({ dir: z.enum(["row", "col"]), ratio: z.number().min(0).max(1), a: treeSchema, b: treeSchema }).strict(),
  ]),
);

export const workspaceDocumentSchema = z
  .object({
    nodeAssets: z.array(z.unknown()),
    nodes: z.record(z.string(), nodeSchema),
    edges: z.record(z.string(), edgeSchema),
    positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() }).strict()),
    sizeOverrides: z.record(
      z.string(),
      z.object({ card: sizeSchema.optional(), full: sizeSchema.optional() }).strict(),
    ),
    formOverride: z.record(z.string(), z.enum(["chip", "card", "full"])),
    formLocked: z.record(z.string(), z.boolean()),
    explicit: z.record(z.string(), z.enum(["embedded", "staged"])),
    stageTree: treeSchema.nullable(),
    stripH: z.number(),
    flags: z.record(z.string(), z.object({ bypass: z.boolean().optional(), off: z.boolean().optional() }).strict()),
    coordinationScopes: z.record(z.string(), z.record(z.string(), z.string())),
    coordinationSpace: z.record(z.string(), z.record(z.string(), jsonValueSchema)),
  })
  .strict()
  .superRefine((doc, context) => {
    try {
      parseWorkspaceNodeAssetRecords(doc.nodeAssets);
    } catch (error) {
      context.addIssue({ code: "custom", path: ["nodeAssets"], message: errorMessage(error) });
    }
    for (const [key, node] of Object.entries(doc.nodes)) {
      if (key !== node.id) context.addIssue({ code: "custom", path: ["nodes", key, "id"], message: "must match key" });
    }
    for (const [key, edge] of Object.entries(doc.edges)) {
      if (key !== edge.id) context.addIssue({ code: "custom", path: ["edges", key, "id"], message: "must match key" });
      for (const end of ["from", "to"] as const) {
        if (!doc.nodes[edge[end]]) {
          context.addIssue({ code: "custom", path: ["edges", key, end], message: `unknown node "${edge[end]}"` });
        }
      }
    }
    for (const [scope, value] of Object.entries(doc.coordinationSpace.focus ?? {})) {
      if (value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) continue;
      context.addIssue({
        code: "custom",
        path: ["coordinationSpace", "focus", scope],
        message: "focus must be a non-negative integer row index or null",
      });
    }
  });

export const workspaceFileSchema = z
  .object({
    format: z.literal(WORKSPACE_FORMAT),
    version: z.literal(WORKSPACE_FORMAT_VERSION),
    revision: z.number().int().nonnegative(),
    document: workspaceDocumentSchema,
  })
  .strict();

export interface WorkspaceIssue {
  /** RFC 6901 JSON Pointer into the validated value. */
  readonly pointer: string;
  readonly detail: string;
}

export type WorkspaceParse<T> = { ok: true; value: T } | { ok: false; issues: WorkspaceIssue[] };

/** Validate a candidate document; issues carry JSON Pointers for agents. */
export function parseWorkspaceDocument(value: unknown): WorkspaceParse<WorkspaceDocument> {
  const parsed = workspaceDocumentSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data as unknown as WorkspaceDocument };
  return { ok: false, issues: toIssues(parsed.error.issues) };
}

export function parseWorkspaceFile(value: unknown): WorkspaceParse<{ revision: number; document: WorkspaceDocument }> {
  const parsed = workspaceFileSchema.safeParse(value);
  if (parsed.success) {
    return {
      ok: true,
      value: { revision: parsed.data.revision, document: parsed.data.document as unknown as WorkspaceDocument },
    };
  }
  return { ok: false, issues: toIssues(parsed.error.issues) };
}

export function toWorkspaceDocument(state: WorkspaceDocumentState): WorkspaceDocument {
  const document: Record<string, unknown> = { ...state };
  for (const field of SESSION_FIELDS) delete document[field];
  return document as WorkspaceDocument;
}

export function withWorkspaceSession(document: WorkspaceDocument, session: WorkspaceSession): WorkspaceDocumentState {
  return { ...document, ...session };
}

export function workspaceSessionOf(state: WorkspaceDocumentState): WorkspaceSession {
  const { selectedNodeId, selectedNodeIds, selectedEdgeId, claimed, graphPath, disposition } = state;
  return { selectedNodeId, selectedNodeIds, selectedEdgeId, claimed, graphPath, disposition };
}

function toIssues(issues: readonly z.core.$ZodIssue[]): WorkspaceIssue[] {
  return issues.map((issue) => ({
    pointer: issue.path.map((part) => `/${String(part).replaceAll("~", "~0").replaceAll("/", "~1")}`).join(""),
    detail: issue.message,
  }));
}

/**
 * Apply RFC 6902 ops to a copy of `document`, stopping at the first failing
 * op. Root (`""`) add/replace swaps the whole value, which `rfc6902` cannot
 * do in place. The result is unvalidated; callers run `parseWorkspaceDocument`.
 */
export function applyWorkspaceOps(document: unknown, ops: readonly Operation[]): WorkspaceParse<unknown> {
  let candidate = structuredClone(document);
  for (const [index, op] of ops.entries()) {
    if (op.path === "" && (op.op === "add" || op.op === "replace")) {
      candidate = structuredClone(op.value);
      continue;
    }
    const [error] = applyPatch(candidate, [op]);
    if (error) return { ok: false, issues: [{ pointer: op.path, detail: `op ${index} (${op.op}): ${error.name}` }] };
  }
  return { ok: true, value: candidate };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
