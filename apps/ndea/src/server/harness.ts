/**
 * The harness: Harness edits mode, proposals, the tool-call feed, and which
 * agents were seen. It validates an agent's named edits, then applies them or
 * holds them as a proposal for the person, and commits only through
 * `Workspace.patch`. One per server process, beside the `Workspace` (so it
 * survives a collection switch), in memory only: a restart drops pending
 * proposals. Proposals keep the named `DashboardEdit`s, not patches, and
 * accepting re-runs the chosen changes against the current revision and
 * commits them as one patch stamped with the proposing agent.
 * In `propose` mode `set_filter` ops still apply directly: filters are
 * exploration state, not layout or source edits.
 */

import {
  JsonPatchOpSchema,
  type HarnessEvent,
  type HarnessMode,
  type HarnessState,
  type Proposal,
  type ToolCall,
  type WorkspaceActor,
} from "@ndea/protocol";
import { createPatch } from "rfc6902";

import type { WorkspaceIssue } from "../frontend/core/workspace/document.ts";
import { findElement, takenIds } from "../frontend/core/workspace/dashboard.ts";
import {
  applyDashboardEdits,
  describeEdit,
  resolveEditReferences,
  WorkspaceEditError,
  type DashboardEdit,
} from "../frontend/core/workspace/edits.ts";
import type { WorkspaceDocument } from "../frontend/core/workspace/types.ts";
import type { Workspace } from "./workspace.ts";

const MAX_FEED = 50;
const MAX_AGENTS = 32;
// ponytail: decided proposals stay readable (get_proposal) until 100 newer ones push them out.
const MAX_PROPOSALS = 100;

export type HarnessEditResult =
  | { kind: "applied"; revision: number; changed: boolean; added: string[] }
  /** `filters`: the batch's `set_filter` ops, applied directly at that revision. */
  | { kind: "proposed"; proposal: Proposal; filters: { revision: number; count: number } | null }
  | { kind: "invalid"; revision: number; reason: string; issues: WorkspaceIssue[] }
  | { kind: "stale"; revision: number };

export class Harness {
  private mode: HarnessMode = "propose";
  /** Insertion order: oldest first. */
  private readonly proposals = new Map<string, Proposal>();
  private readonly feed: ToolCall[] = [];
  /** Agent name → last seen; insertion order: least recently seen first. */
  private readonly agents = new Map<string, string>();
  private readonly listeners = new Set<(event: HarnessEvent) => void>();
  /** Decisions run one at a time, so a change can never be accepted twice. */
  private queue: Promise<unknown> = Promise.resolve();

  private readonly workspace: Workspace;

  constructor(workspace: Workspace) {
    this.workspace = workspace;
  }

  state(): HarnessState {
    return {
      agents: [...this.agents].toReversed().map(([agent, lastSeen]) => ({ agent, lastSeen })),
      mode: this.mode,
      proposals: [...this.proposals.values()].filter((p) => p.changes.some((c) => c.status === "pending")),
      feed: [...this.feed],
    };
  }

  /** Call `listener` with the state now and after every change (agents seen too), until the returned dispose. */
  watch(listener: (event: HarnessEvent) => void): () => void {
    listener({ kind: "state", state: this.state() });
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Record an `X-Ndea-Agent` sighting; keeps the 32 most recently seen agents. */
  seen(agent: string): void {
    this.agents.delete(agent);
    this.agents.set(agent, new Date().toISOString());
    if (this.agents.size > MAX_AGENTS) this.agents.delete(this.agents.keys().next().value!);
    this.changed();
  }

  setMode(mode: HarnessMode): void {
    this.mode = mode;
    this.changed();
  }

  get proposing(): boolean {
    return this.mode === "propose";
  }

  proposal(id: string): Proposal | undefined {
    return this.proposals.get(id);
  }

  /** Add one MCP tool call to the feed, newest first. */
  record(call: Omit<ToolCall, "at">): void {
    this.feed.unshift({ at: new Date().toISOString(), ...call });
    this.feed.length = Math.min(this.feed.length, MAX_FEED);
    this.changed();
  }

  /** Tell the app an agent's edit was refused as invalid. */
  rejected(actor: WorkspaceActor, reason: string, issues: readonly WorkspaceIssue[]): void {
    const event: HarnessEvent = {
      kind: "rejected",
      at: new Date().toISOString(),
      agent: actor.agent ?? null,
      reason,
      issues: [...issues],
    };
    for (const listener of this.listeners) listener(event);
  }

  /**
   * Run an agent's batch: applied in `direct` mode; in `propose` mode the whole
   * batch is validated, its filters apply, and the rest becomes a proposal.
   * `expected`: apply only at this revision.
   */
  async edit(edits: readonly DashboardEdit[], actor: WorkspaceActor, expected?: number): Promise<HarnessEditResult> {
    const result = await this.run(edits, actor, expected);
    if (result.kind === "invalid") this.rejected(actor, result.reason, result.issues);
    return result;
  }

  /** Commit the chosen pending changes (default all), in order, as one revision; a change that no longer applies turns `invalid`. */
  accept(
    id: string,
    changes?: readonly number[],
  ): Promise<{ revision: number | null; proposal: Proposal } | undefined> {
    return this.enqueue(async () => {
      const proposal = this.proposals.get(id);
      if (!proposal) return;
      const selected = proposal.changes.filter(
        (change) => change.status === "pending" && (!changes || changes.includes(change.index)),
      );
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { revision, document: base } = this.snapshot();
        const outcome = new Map<number, string | null>(); // index → invalid reason, or null when it applies
        let draft = base;
        for (const change of selected) {
          let next: WorkspaceDocument;
          try {
            next = applyDashboardEdits(draft, [change.op as DashboardEdit]);
          } catch (error) {
            outcome.set(change.index, (error as Error).message);
            continue;
          }
          const issues = await this.workspace.check(next);
          if (issues.length > 0) {
            outcome.set(change.index, issues.map((issue) => `${issue.pointer}: ${issue.detail}`).join("; "));
            continue;
          }
          outcome.set(change.index, null);
          draft = next;
        }
        const ops = JsonPatchOpSchema.array().parse(createPatch(base, draft));
        let committed: number | null = null;
        if (ops.length > 0) {
          const result = await this.workspace.patch(ops, { base: revision, actor: proposal.actor });
          if (result.kind === "conflict") continue;
          if (result.kind === "invalid") {
            const reason = result.issues.map((issue) => `${issue.pointer}: ${issue.detail}`).join("; ");
            for (const [index, invalid] of outcome) outcome.set(index, invalid ?? reason);
          } else {
            committed = result.revision;
          }
        }
        for (const change of selected) {
          const reason = outcome.get(change.index);
          change.status = reason ? "invalid" : "accepted";
          if (reason) change.reason = reason;
        }
        this.changed();
        return { revision: committed, proposal };
      }
      // Two concurrent writes in a row: the changes stay pending for another try.
      return { revision: null, proposal };
    });
  }

  /** Reject the chosen pending changes (default all). */
  reject(id: string, changes?: readonly number[]): Promise<Proposal | undefined> {
    return this.enqueue(() => {
      const proposal = this.proposals.get(id);
      if (!proposal) return;
      for (const change of proposal.changes) {
        if (change.status === "pending" && (!changes || changes.includes(change.index))) change.status = "rejected";
      }
      this.changed();
      return proposal;
    });
  }

  private async run(
    edits: readonly DashboardEdit[],
    actor: WorkspaceActor,
    expected: number | undefined,
  ): Promise<HarnessEditResult> {
    const { revision, document: base } = this.snapshot();
    let resolved: DashboardEdit[];
    try {
      resolved = resolveEditReferences(edits, this.workspace.name);
    } catch (error) {
      return editError(error, revision);
    }
    if (this.mode === "direct") return this.apply(resolved, actor, expected);

    if (expected !== undefined && expected !== revision) return { kind: "stale", revision };
    let next: WorkspaceDocument;
    try {
      next = applyDashboardEdits(base, resolved);
    } catch (error) {
      return editError(error, revision);
    }
    const issues = await this.workspace.check(next);
    if (issues.length > 0) {
      return {
        kind: "invalid",
        revision,
        reason: "the edit would leave an invalid workspace; nothing was applied",
        issues,
      };
    }

    const filters = resolved.filter((edit) => edit.op === "set_filter");
    const rest = resolved.filter((edit) => edit.op !== "set_filter");
    let applied: { revision: number; count: number } | null = null;
    if (filters.length > 0) {
      const result = await this.apply(filters, actor);
      if (result.kind !== "applied" || rest.length === 0) return result;
      applied = { revision: result.revision, count: filters.length };
    }

    const current = this.snapshot();
    let draft = current.document;
    const proposal: Proposal = {
      id: crypto.randomUUID(),
      actor,
      createdAt: new Date().toISOString(),
      baseRevision: current.revision,
      changes: rest.map((edit, index) => {
        const summary = describeEdit(edit, draft);
        const before = draft;
        draft = applyDashboardEdits(draft, [edit]);
        return { index, op: pinIds(edit, before, draft), summary, status: "pending" as const };
      }),
    };
    this.proposals.set(proposal.id, proposal);
    if (this.proposals.size > MAX_PROPOSALS) this.proposals.delete(this.proposals.keys().next().value!);
    this.changed();
    return { kind: "proposed", proposal, filters: applied };
  }

  /**
   * Compile edits against the current document and commit them as one patch.
   * Without an expected revision, a concurrent write is retried once against
   * the newer document, since named edits address ids, not positions.
   */
  private async apply(
    edits: readonly DashboardEdit[],
    actor: WorkspaceActor,
    expected?: number,
  ): Promise<HarnessEditResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { revision, document: base } = this.snapshot();
      if (expected !== undefined && expected !== revision) return { kind: "stale", revision };
      let next: WorkspaceDocument;
      try {
        next = applyDashboardEdits(base, edits);
      } catch (error) {
        return editError(error, revision);
      }
      const ops = JsonPatchOpSchema.array().parse(createPatch(base, next));
      if (ops.length === 0) return { kind: "applied", revision, changed: false, added: [] };
      const result = await this.workspace.patch(ops, { base: revision, actor });
      if (result.kind === "accepted") {
        const before = takenIds(base);
        const added = [...takenIds(next)].filter((id) => !before.has(id));
        return { kind: "applied", revision: result.revision, changed: true, added };
      }
      if (result.kind === "invalid") {
        return {
          kind: "invalid",
          revision,
          reason: "the edit would leave an invalid workspace; nothing was applied",
          issues: result.issues,
        };
      }
      if (expected !== undefined) break;
    }
    return { kind: "stale", revision: this.workspace.get().revision };
  }

  private snapshot(): { revision: number; document: WorkspaceDocument } {
    // The workspace only holds documents that passed `parseWorkspaceDocument`.
    const { revision, document } = this.workspace.get();
    return { revision, document: document as WorkspaceDocument };
  }

  private changed(): void {
    const event: HarnessEvent = { kind: "state", state: this.state() };
    for (const listener of this.listeners) listener(event);
  }

  private enqueue<T>(run: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => {});
    return next;
  }
}

function editError(error: unknown, revision: number): HarnessEditResult {
  if (!(error instanceof WorkspaceEditError)) throw error;
  return {
    kind: "invalid",
    revision,
    reason: "edit rejected; nothing was applied",
    issues: [{ pointer: `/ops/${error.index}`, detail: error.message }],
  };
}

/**
 * Name the ids an add drew fresh, so a later change in the proposal that
 * uses them still means the same view (or layout) when accepted.
 */
function pinIds(edit: DashboardEdit, before: WorkspaceDocument, after: WorkspaceDocument): DashboardEdit {
  if (edit.op === "add_layout" && edit.id === undefined) {
    return { ...edit, id: Object.keys(after.layouts).find((id) => !Object.hasOwn(before.layouts, id)) };
  }
  if ((edit.op === "add" || edit.op === "add_tab") && edit.id === undefined) {
    const taken = takenIds(before);
    const id = [...takenIds(after)].find(
      (candidate) => !taken.has(candidate) && findElement(after, candidate)?.type === edit.type,
    );
    return { ...edit, id };
  }
  return edit;
}
