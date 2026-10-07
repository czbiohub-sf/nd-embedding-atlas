/**
 * GET   /api/workspace: current revision and document.
 * PATCH /api/workspace: apply RFC 6902 ops against a base revision.
 *   200 { revision } · 409 stale revision + current snapshot · 400 RFC 9457 problem.
 * GET   /api/workspace/nodes/:id?limit=N: one node's evaluated output at the current revision.
 */

import {
  WorkspacePatchBodySchema,
  type WorkspaceConflict,
  type WorkspaceNodeResult,
  type WorkspacePatchAccepted,
  type WorkspaceProblem,
} from "@ndea/protocol";
import { WorkspaceEvaluator } from "../graph.ts";
import { queryObservations } from "../observations.ts";
import type { ServerSession } from "../state.ts";
import type { WorkspaceDocumentStore } from "../workspace.ts";
import { observationSetIssues } from "../observation-sets.ts";

const evaluators = new WeakMap<WorkspaceDocumentStore, WorkspaceEvaluator>();

function evaluatorFor(workspace: WorkspaceDocumentStore): WorkspaceEvaluator {
  let evaluator = evaluators.get(workspace);
  if (!evaluator) evaluators.set(workspace, (evaluator = new WorkspaceEvaluator(workspace)));
  return evaluator;
}

export function handleWorkspaceGet(state: Pick<ServerSession, "workspace">): Response {
  return Response.json(state.workspace.snapshot());
}

export async function handleWorkspacePatch(
  req: Request,
  state: Pick<ServerSession, "workspace" | "observationSets">,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return problem("Invalid JSON body", []);
  }
  const body = WorkspacePatchBodySchema.safeParse(raw);
  if (!body.success) {
    return problem(
      "Request body failed validation",
      body.error.issues.map((issue) => ({ pointer: `/${issue.path.join("/")}`, detail: issue.message })),
    );
  }

  const result = await state.workspace.apply(body.data.baseRevision, body.data.ops, body.data.clientId, (document) =>
    observationSetIssues(document, state.observationSets),
  );
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

export async function handleWorkspaceNode(
  nodeId: string,
  url: URL,
  state: Pick<ServerSession, "workspace" | "store" | "datasets">,
): Promise<Response> {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 0, 0), 1_000_000);
  const evaluation = evaluatorFor(state.workspace).evaluate(nodeId);
  const base = { revision: evaluation.revision, nodeId };
  if (evaluation.status === "missing") {
    return Response.json({ ...base, error: `no node "${nodeId}" in the workspace` }, { status: 404 });
  }
  if (evaluation.status !== "resolved") return Response.json({ ...base, ...evaluation } satisfies WorkspaceNodeResult);

  const { value } = evaluation;
  try {
    const page = await queryObservations(state, value.sql, limit);
    const result: WorkspaceNodeResult = {
      ...base,
      status: "resolved",
      output: { kind: value.kind, sql: value.sql, scopeFilter: evaluation.scopeFilter, ...page },
    };
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ...base, status: "error", error: message } satisfies WorkspaceNodeResult);
  }
}
