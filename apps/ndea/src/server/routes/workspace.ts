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
 * Writes are stamped `browser`, or `cli` when the request carries
 * `X-Ndea-Client: cli`. `workspaceIssues` is the session `Workspace`'s
 * injected validation; `workspaceResult` is shared with MCP.
 */

import {
  WorkspacePatchBodySchema,
  WorkspaceRestoreBodySchema,
  type FilterClause,
  type WorkspaceActor,
  type WorkspaceConflict,
  type WorkspaceHistory,
  type WorkspacePatchAccepted,
  type WorkspaceProblem,
} from "@ndea/protocol";
import { z } from "zod";
import { COMPONENTS } from "../../frontend/core/workspace/dashboard.ts";
import { dataSourceSql, elementPredicate } from "../../frontend/core/workspace/data-sources.ts";
import type { WorkspaceIssue } from "../../frontend/core/workspace/document.ts";
import type { WorkspaceDocument } from "../../frontend/core/workspace/types.ts";
import { escapePointer, observationSetIssues } from "../observation-sets.ts";
import { countObservations, PREDICATE_ERROR_RE } from "../observations.ts";
import type { ServerSession } from "../state.ts";
import type { WorkspacePatchResult } from "../workspace.ts";

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

export async function handleWorkspacePatch(req: Request, state: Pick<ServerSession, "workspace">): Promise<Response> {
  const body = await parseBody(req, WorkspacePatchBodySchema);
  if (body instanceof Response) return body;
  return writeResponse(
    await state.workspace.patch(body.ops, { base: body.baseRevision, actor: restActor(req), clientId: body.clientId }),
  );
}

export async function handleWorkspaceRestore(req: Request, state: Pick<ServerSession, "workspace">): Promise<Response> {
  const body = await parseBody(req, WorkspaceRestoreBodySchema);
  if (body instanceof Response) return body;
  const result = await state.workspace.restore(body.revision, {
    base: body.baseRevision,
    actor: restActor(req),
    clientId: body.clientId,
  });
  if (result.kind === "not-found") {
    return Response.json({ error: `Unknown workspace revision ${body.revision}` }, { status: 404 });
  }
  return writeResponse(result);
}

/** Provenance, not authorization: localhost is the trust boundary. */
function restActor(req: Request): WorkspaceActor {
  return { kind: req.headers.get("x-ndea-client") === "cli" ? "cli" : "browser" };
}

async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return problem("Invalid JSON body", []);
  }
  const body = schema.safeParse(raw);
  if (body.success) return body.data;
  return problem(
    "Request body failed validation",
    body.error.issues.map((issue) => ({ pointer: `/${issue.path.join("/")}`, detail: issue.message })),
  );
}

function writeResponse(result: WorkspacePatchResult): Response {
  if (result.kind === "conflict") {
    const conflict: WorkspaceConflict = { error: "stale revision", ...result.snapshot };
    return Response.json(conflict, { status: 409 });
  }
  if (result.kind === "invalid") return problem("Patch produces an invalid workspace document", result.issues);
  const accepted: WorkspacePatchAccepted = { revision: result.revision };
  return Response.json(accepted);
}

function problem(detail: string, errors: WorkspaceProblem["errors"]): Response {
  const body: WorkspaceProblem = { type: "about:blank", title: "Invalid workspace patch", status: 400, detail, errors };
  return Response.json(body, { status: 400, headers: { "content-type": "application/problem+json" } });
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
    const element = Object.hasOwn(doc.spec.elements, id) ? doc.spec.elements[id] : undefined;
    if (!element) return { status: 404, body: { revision, error: `no element "${id}" in the dashboard` } };
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
