/**
 * Workspace write policy, shared by REST (`routes/workspace.ts`) and MCP
 * (`mcp.ts`): who the writer is, whether Harness edits mode lets them write,
 * and what an outcome means. Each transport keeps only its response format.
 *
 * - Actors come from the transport, never the body: REST is `browser`, or
 *   `cli` with `X-Ndea-Client: cli`; MCP is `mcp`, naming the agent from a
 *   well-formed `X-Ndea-Agent`. Provenance, not authorization.
 * - In propose mode an agent's raw patch or restore is refused (its named edits
 *   go through `Harness.edit` instead). Browser and CLI writes are the person's
 *   own and never wait for review.
 * - An agent's invalid write is reported to the app as a harness `rejected` event.
 */

import { WorkspaceActorSchema, type JsonPatchOp, type WorkspaceActor, type WorkspaceSnapshot } from "@ndea/protocol";
import type { WorkspaceIssue } from "../frontend/core/workspace/document.ts";
import type { ServerSession } from "./state.ts";
import type { WorkspacePatchResult, WorkspaceWrite } from "./workspace.ts";

type Session = Pick<ServerSession, "workspace" | "harness">;

export type WorkspaceWriteResult =
  | { kind: "accepted"; revision: number }
  | { kind: "conflict"; snapshot: WorkspaceSnapshot }
  | { kind: "invalid"; reason: string; issues: WorkspaceIssue[] }
  /** An agent's raw write while Harness edits are set to propose. */
  | { kind: "refused"; reason: string };

/** The REST actor: `cli` when the request says so, else `browser`. */
export function restActor(headers: Headers): WorkspaceActor {
  return { kind: headers.get("x-ndea-client") === "cli" ? "cli" : "browser" };
}

/** The MCP actor: `X-Ndea-Agent` names the agent when it is well formed. */
export function mcpActor(headers: Headers | undefined): WorkspaceActor {
  const actor = WorkspaceActorSchema.safeParse({ kind: "mcp", agent: headers?.get("x-ndea-agent") ?? undefined });
  return actor.success ? actor.data : { kind: "mcp" };
}

/** Commit RFC 6902 `ops` at `write.base`, if `write.actor` may write now. */
export async function patchWorkspace(
  session: Session,
  ops: readonly JsonPatchOp[],
  write: WorkspaceWrite,
): Promise<WorkspaceWriteResult> {
  return (
    refusal(session, write.actor) ??
    outcome(
      session,
      write.actor,
      await session.workspace.patch(ops, write),
      "the patch would leave an invalid workspace",
    )
  );
}

/** Commit the document at `revision` again as a new revision, if `write.actor` may write now. */
export async function restoreWorkspace(
  session: Session,
  revision: number,
  write: WorkspaceWrite,
): Promise<WorkspaceWriteResult | { kind: "not-found" }> {
  const refused = refusal(session, write.actor);
  if (refused) return refused;
  const result = await session.workspace.restore(revision, write);
  return result.kind === "not-found"
    ? result
    : outcome(session, write.actor, result, "restoring would leave an invalid workspace");
}

function refusal(session: Session, actor: WorkspaceActor): WorkspaceWriteResult | null {
  if (actor.kind !== "mcp" || !session.harness.proposing) return null;
  return {
    kind: "refused",
    reason:
      "the person reviews harness edits; use edit_dashboard, or ask them to switch Harness edits to Apply directly",
  };
}

function outcome(
  session: Session,
  actor: WorkspaceActor,
  result: WorkspacePatchResult,
  invalid: string,
): WorkspaceWriteResult {
  if (result.kind !== "invalid") return result;
  const reason = `${invalid}; nothing was applied`;
  if (actor.kind === "mcp") session.harness.rejected(actor, reason, result.issues);
  return { kind: "invalid", reason, issues: result.issues };
}
