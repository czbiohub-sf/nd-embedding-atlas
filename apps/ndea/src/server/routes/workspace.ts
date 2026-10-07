/**
 * GET   /api/workspace: current revision and document.
 * PATCH /api/workspace: apply RFC 6902 ops against a base revision.
 *   200 { revision } · 409 stale revision + current snapshot · 400 RFC 9457 problem.
 */

import {
  WorkspacePatchBodySchema,
  type WorkspaceConflict,
  type WorkspacePatchAccepted,
  type WorkspaceProblem,
} from "@ndea/protocol";
import type { ServerSession } from "../state.ts";

export function handleWorkspaceGet(state: Pick<ServerSession, "workspace">): Response {
  return Response.json(state.workspace.snapshot());
}

export async function handleWorkspacePatch(req: Request, state: Pick<ServerSession, "workspace">): Promise<Response> {
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

  const result = await state.workspace.apply(body.data.baseRevision, body.data.ops, body.data.clientId);
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
