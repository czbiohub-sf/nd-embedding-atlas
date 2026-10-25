/**
 * The harness: agents editing the workspace over MCP. In `propose` mode their
 * layout and source edits wait as proposals until the person accepts or
 * rejects each change; filters still apply directly. The queue lives in server
 * memory, outside the document: a restart drops pending proposals.
 */

import { z } from "zod";
import { WorkspaceActorSchema } from "./workspace";

export const HarnessModeSchema = z.enum(["propose", "direct"]);
export type HarnessMode = z.infer<typeof HarnessModeSchema>;

/** An agent named by `X-Ndea-Agent`; `lastSeen`: ISO 8601. */
export const HarnessAgentSchema = z.object({ agent: z.string(), lastSeen: z.string() });
export type HarnessAgent = z.infer<typeof HarnessAgentSchema>;

/** One proposed change: a named `DashboardEdit` (parse `op` with `DashboardEditSchema`). */
export const ProposalChangeSchema = z.object({
  index: z.number().int().nonnegative(),
  op: z.unknown(),
  /** Glossary words, e.g. "Add Histogram beside Table". */
  summary: z.string(),
  /** `invalid`: the change no longer applied to the current workspace when accepted; see `reason`. */
  status: z.enum(["pending", "accepted", "rejected", "invalid"]),
  reason: z.string().optional(),
});
export type ProposalChange = z.infer<typeof ProposalChangeSchema>;

export const ProposalSchema = z.object({
  id: z.string(),
  actor: WorkspaceActorSchema,
  createdAt: z.string(),
  /** The revision the changes were validated against; accepting re-runs them on the current one. */
  baseRevision: z.number().int().nonnegative(),
  changes: z.array(ProposalChangeSchema),
});
export type Proposal = z.infer<typeof ProposalSchema>;

/** One MCP tool call in the harness feed. */
export const ToolCallSchema = z.object({
  at: z.string(),
  agent: z.string().nullable(),
  tool: z.string(),
  /** The arguments in a few words. */
  summary: z.string(),
  /** "applied", "proposed", "rejected: …", "→ 7,688 obs", … */
  outcome: z.string(),
  /** Whether the call wrote (or tried to write) the workspace. */
  write: z.boolean(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** GET /api/harness and the `harness/watch` `state` push. */
export const HarnessStateSchema = z.object({
  /** Most recently seen first. */
  agents: z.array(HarnessAgentSchema),
  mode: HarnessModeSchema,
  /** Proposals with a pending change, oldest first. */
  proposals: z.array(ProposalSchema),
  /** Newest first, at most 50. */
  feed: z.array(ToolCallSchema),
});
export type HarnessState = z.infer<typeof HarnessStateSchema>;

/** `harness/watch` push: the state on subscribe and every change, plus one `rejected` per invalid harness edit. */
export const HarnessEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("state"), state: HarnessStateSchema }),
  z.object({
    kind: z.literal("rejected"),
    at: z.string(),
    agent: z.string().nullable(),
    reason: z.string(),
    issues: z.array(z.object({ pointer: z.string(), detail: z.string() })),
  }),
]);
export type HarnessEvent = z.infer<typeof HarnessEventSchema>;

/** PUT /api/harness/mode. */
export const HarnessModeBodySchema = z.object({ mode: HarnessModeSchema });
export type HarnessModeBody = z.infer<typeof HarnessModeBodySchema>;

/** POST /api/proposals/:id/accept and /reject; no `changes` = every pending change. */
export const ProposalDecisionBodySchema = z.object({
  changes: z.array(z.number().int().nonnegative()).optional(),
});
export type ProposalDecisionBody = z.infer<typeof ProposalDecisionBodySchema>;

/** 200 response to accept: `revision` is null when no change applied; `proposal` carries each change's status after the decision. */
export const ProposalAcceptedSchema = z.object({
  revision: z.number().int().positive().nullable(),
  proposal: ProposalSchema.nullable(),
});
export type ProposalAccepted = z.infer<typeof ProposalAcceptedSchema>;

/** 200 response to reject. */
export const ProposalRejectedSchema = z.object({ proposal: ProposalSchema.nullable() });
export type ProposalRejected = z.infer<typeof ProposalRejectedSchema>;
