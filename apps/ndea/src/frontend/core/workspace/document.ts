/**
 * The workspace document: server-owned and file-persisted. Four fields:
 * `data` (named data sources), `layouts` (named json-render dashboards),
 * `layout` (the active layout's id), and `state` (coordination cells every
 * layout binds). Pure (Zod only) so the server and the browser validate with
 * the same schema. Editor session state lives in `Workspace.session` and never
 * reaches it. Only the exact format version loads; there are no migrations.
 */

import { applyPatch, type Operation } from "rfc6902";
import { z } from "zod";

import { coordinationStateSchema } from "../coordination/types";
import { emptyDashboard, layoutIssues, layoutsSchema } from "./dashboard";
import { dataIssues, dataSchema } from "./data-sources";
import type { WorkspaceDocument } from "./types";

export const WORKSPACE_FORMAT = "ndea.workspace";
export const WORKSPACE_FORMAT_VERSION = 3;

export const workspaceDocumentSchema = z
  .object({ data: dataSchema, layouts: layoutsSchema, layout: z.string(), state: coordinationStateSchema })
  .strict()
  .superRefine((doc, context) => {
    for (const [path, message] of [...dataIssues(doc.data), ...layoutIssues(doc, doc.data)]) {
      context.addIssue({ code: "custom", path, message });
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
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, issues: toIssues(parsed.error.issues) };
}

export function parseWorkspaceFile(value: unknown): WorkspaceParse<{ revision: number; document: WorkspaceDocument }> {
  const parsed = workspaceFileSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: { revision: parsed.data.revision, document: parsed.data.document } };
  return { ok: false, issues: toIssues(parsed.error.issues) };
}

/** No data sources and one layout of one empty slot: the base an agent builds a dashboard from. */
export function emptyWorkspaceDocument(): WorkspaceDocument {
  return { data: {}, layouts: { main: { name: "Main", spec: emptyDashboard() } }, layout: "main", state: {} };
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
