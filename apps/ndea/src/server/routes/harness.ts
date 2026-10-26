/**
 * GET  /api/harness: agents, Harness edits mode, pending proposals, tool-call feed.
 * PUT  /api/harness/mode { mode }: the person switches between propose and direct.
 * POST /api/proposals/:id/accept { changes? }: commit the chosen pending changes (default all)
 *   as one revision stamped with the proposing agent → { revision | null, proposal } · 404 unknown.
 * POST /api/proposals/:id/reject { changes? } → { proposal } · 404 unknown.
 *
 * Browser actions under the same loopback trust as the other REST writes.
 */

import {
  HarnessModeBodySchema,
  ProposalDecisionBodySchema,
  type HarnessState,
  type ProposalAccepted,
  type ProposalRejected,
} from "@ndea/protocol";

import type { ServerSession } from "../state.ts";
import { parseBody } from "../request-body.ts";

type State = Pick<ServerSession, "harness">;

const unknownProposal = (id: string) => Response.json({ error: `Unknown proposal ${id}` }, { status: 404 });

export function handleHarnessGet(state: State): Response {
  const body: HarnessState = state.harness.state();
  return Response.json(body);
}

export async function handleHarnessMode(req: Request, state: State): Promise<Response> {
  const body = await parseBody(req, HarnessModeBodySchema);
  if (body instanceof Response) return body;
  state.harness.setMode(body.mode);
  return handleHarnessGet(state);
}

export async function handleProposalAccept(req: Request, id: string, state: State): Promise<Response> {
  const body = await parseBody(req, ProposalDecisionBodySchema);
  if (body instanceof Response) return body;
  const result = await state.harness.accept(id, body.changes);
  if (!result) return unknownProposal(id);
  const accepted: ProposalAccepted = result;
  return Response.json(accepted);
}

export async function handleProposalReject(req: Request, id: string, state: State): Promise<Response> {
  const body = await parseBody(req, ProposalDecisionBodySchema);
  if (body instanceof Response) return body;
  const proposal = await state.harness.reject(id, body.changes);
  if (!proposal) return unknownProposal(id);
  const rejected: ProposalRejected = { proposal };
  return Response.json(rejected);
}
