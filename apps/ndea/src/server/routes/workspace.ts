/**
 * GET   /api/workspace: current revision and document.
 * PATCH /api/workspace: apply RFC 6902 ops against a base revision.
 *   200 { revision } · 409 stale revision + current snapshot · 400 RFC 9457 problem.
 * GET   /api/workspace/history?before&limit: committed revisions, newest first.
 * GET   /api/workspace/revisions/:revision: the document at one revision · 404 unknown.
 * POST  /api/workspace/restore: commit an earlier revision's document as a new revision;
 *   responses as PATCH, plus 404 for an unknown revision.
 * GET   /api/workspace/elements/:id: what one dashboard element shows.
 * GET   /api/workspace/data/:name: what one data source selects.
 *   200 { revision, predicate, count } · 404 unknown id · 400 the element reads no data or its SQL fails.
 *
 * Writes go through `workspace-writes.ts` (stamped `browser`, or `cli` with
 * `X-Ndea-Client: cli`); this module only maps outcomes to HTTP.
 * `workspaceIssues` is the session `Workspace`'s injected validation;
 * `workspaceResult` is shared with MCP.
 */

import {
  WorkspacePatchBodySchema,
  WorkspaceRestoreBodySchema,
  type FilterClause,
  type WorkspaceConflict,
  type WorkspaceHistory,
  type WorkspacePatchAccepted,
} from "@ndea/protocol";
import { z } from "zod";
import { COMPONENTS, findElement } from "../../frontend/core/workspace/dashboard.ts";
import { dataSourceSql, elementPredicate } from "../../frontend/core/workspace/data-sources.ts";
import type { WorkspaceIssue } from "../../frontend/core/workspace/document.ts";
import type { WorkspaceDocument } from "../../frontend/core/workspace/types.ts";
import { escapePointer, observationSetIssues } from "../observation-sets.ts";
import { countObservations, PREDICATE_ERROR_RE } from "../observations.ts";
import { parseBody, problem } from "../request-body.ts";
import type { ServerSession } from "../state.ts";
import { patchWorkspace, restActor, restoreWorkspace, type WorkspaceWriteResult } from "../workspace-writes.ts";

const HistoryQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

/**
 * What a structurally valid document references that this dataset lacks:
 * unknown observation sets anywhere, and unknown columns in typed clauses
 * (data-source `where`, `state.filter`). Raw `data.sql` stays opaque; DuckDB
 * rejects a bad one when it runs.
 */
export async function workspaceIssues(
  document: WorkspaceDocument,
  state: Pick<ServerSession, "observationSets" | "store">,
): Promise<WorkspaceIssue[]> {
  const columns = state.store.columns();
  const issues: WorkspaceIssue[] = [];
  const visit = (clause: FilterClause, pointer: string): void => {
    if ("column" in clause && !columns.has(clause.column)) {
      issues.push({ pointer: `${pointer}/column`, detail: `unknown column "${clause.column}"` });
    }
    if ("clauses" in clause) clause.clauses.forEach((child, i) => visit(child, `${pointer}/clauses/${i}`));
    if ("clause" in clause) visit(clause.clause, `${pointer}/clause`);
  };
  for (const [name, source] of Object.entries(document.data)) {
    if (source.where) visit(source.where, `/data/${name}/where`);
  }
  for (const [scope, sources] of Object.entries(document.state.filter ?? {})) {
    for (const [source, facets] of Object.entries(sources)) {
      for (const [facet, clause] of Object.entries(facets)) {
        visit(clause, `/state/filter/${scope}/${escapePointer(source)}/${escapePointer(facet)}`);
      }
    }
  }
  return [...(await observationSetIssues(document, state.observationSets)), ...issues];
}

export function handleWorkspaceGet(state: Pick<ServerSession, "workspace">): Response {
  return Response.json(state.workspace.get());
}

export function handleWorkspaceHistory(req: Request, state: Pick<ServerSession, "workspace">): Response {
  const query = HistoryQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return Response.json({ error: z.prettifyError(query.error) }, { status: 400 });
  const history: WorkspaceHistory = { revisions: state.workspace.history(query.data) };
  return Response.json(history);
}

export function handleWorkspaceRevision(revision: string, state: Pick<ServerSession, "workspace">): Response {
  const snapshot = state.workspace.at(Number(revision));
  return snapshot
    ? Response.json(snapshot)
    : Response.json({ error: `Unknown workspace revision ${revision}` }, { status: 404 });
}

type Writable = Pick<ServerSession, "workspace" | "harness">;

export async function handleWorkspacePatch(req: Request, state: Writable): Promise<Response> {
  const body = await parseBody(req, WorkspacePatchBodySchema);
  if (body instanceof Response) return body;
  const write = { base: body.baseRevision, actor: restActor(req.headers), clientId: body.clientId };
  return writeResponse(await patchWorkspace(state, body.ops, write));
}

export async function handleWorkspaceRestore(req: Request, state: Writable): Promise<Response> {
  const body = await parseBody(req, WorkspaceRestoreBodySchema);
  if (body instanceof Response) return body;
  const write = { base: body.baseRevision, actor: restActor(req.headers), clientId: body.clientId };
  const result = await restoreWorkspace(state, body.revision, write);
  if (result.kind === "not-found") {
    return Response.json({ error: `Unknown workspace revision ${body.revision}` }, { status: 404 });
  }
  return writeResponse(result);
}

function writeResponse(result: WorkspaceWriteResult): Response {
  switch (result.kind) {
    case "accepted": {
      const accepted: WorkspacePatchAccepted = { revision: result.revision };
      return Response.json(accepted);
    }
    case "conflict": {
      const conflict: WorkspaceConflict = { error: "stale revision", ...result.snapshot };
      return Response.json(conflict, { status: 409 });
    }
    case "invalid":
      return problem(result.reason, result.issues, "Invalid workspace patch");
    case "refused":
      return Response.json({ error: result.reason }, { status: 403 });
  }
}

export type WorkspaceResult =
  | { status: 200; body: { revision: number; predicate: string | null; count: number } }
  | { status: 400 | 404 | 500; body: { revision: number; predicate?: string | null; error: string } };

/**
 * What an element shows (its data source AND the other members' clauses in its
 * filter scope) or what a data source selects, at the current revision.
 */
export async function workspaceResult(
  state: Pick<ServerSession, "workspace" | "store">,
  target: { element: string } | { data: string },
): Promise<WorkspaceResult> {
  const { revision, document } = state.workspace.get();
  // The workspace only holds documents that passed `parseWorkspaceDocument`.
  const doc = document as WorkspaceDocument;
  let predicate: string | null;
  if ("element" in target) {
    const id = target.element;
    const element = findElement(doc, id);
    if (!element) return { status: 404, body: { revision, error: `no element "${id}" in any layout` } };
    if (!COMPONENTS[element.type]?.reads) {
      return { status: 400, body: { revision, error: `element "${id}" (${element.type}) reads no data` } };
    }
    predicate = elementPredicate(doc, id);
  } else {
    if (!Object.hasOwn(doc.data, target.data)) {
      return { status: 404, body: { revision, error: `no data source "${target.data}"` } };
    }
    predicate = dataSourceSql(doc.data, target.data);
  }
  try {
    return { status: 200, body: { revision, predicate, count: await countObservations(state.store, predicate) } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: PREDICATE_ERROR_RE.test(message) ? 400 : 500, body: { revision, predicate, error: message } };
  }
}

export async function handleWorkspaceResult(
  target: { element: string } | { data: string },
  state: Pick<ServerSession, "workspace" | "store">,
): Promise<Response> {
  const { status, body } = await workspaceResult(state, target);
  return Response.json(body, { status });
}
