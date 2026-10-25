/**
 * Browser half of the server-owned workspace document.
 *
 * Local edits apply to the `Workspace` store immediately. After a quiet
 * period the sync diffs the committed document against the last
 * server-acknowledged one and PATCHes the difference. A stale revision (409)
 * rebases: pending ops replay on the server document and resend. Remote
 * revisions from `workspace/watch` rebase pending local ops the same way;
 * `clientId` tells this tab's own echoes apart.
 */

import {
  WorkspaceConflictSchema,
  WorkspacePatchAcceptedSchema,
  WorkspaceProblemSchema,
  WorkspaceSnapshotSchema,
  type JsonPatchOp,
  type WorkspaceChange,
  type WorkspaceRevision,
  type WorkspaceSnapshot,
} from "@ndea/protocol";
import { createPatch } from "rfc6902";

import { applyWorkspaceOps, parseWorkspaceDocument } from "./document";
import type { WorkspaceDocument } from "./types";
import type { WorkspaceStore } from "./workspace-store";

/** Collapses a drag or typing burst into one revision. */
const SYNC_DEBOUNCE_MS = 500;

export interface WorkspaceTransport {
  patch(baseRevision: number, ops: JsonPatchOp[], clientId: string): Promise<PatchOutcome>;
  watch(onChange: (change: WorkspaceChange) => void, onLost: () => void): () => void;
  snapshot(): Promise<WorkspaceSnapshot>;
}

export type PatchOutcome =
  | { kind: "accepted"; revision: number }
  | { kind: "conflict"; snapshot: WorkspaceSnapshot }
  | { kind: "invalid"; errors: string[] };

/** Validate a server document with the schema the server enforces. */
export function decodeWorkspaceDocument(
  value: unknown,
): { ok: true; state: WorkspaceDocument } | { ok: false; errors: string[] } {
  const parsed = parseWorkspaceDocument(value);
  if (!parsed.ok) return { ok: false, errors: parsed.issues.map((issue) => `${issue.pointer}: ${issue.detail}`) };
  return { ok: true, state: parsed.value };
}

export class WorkspaceSync {
  private readonly workspace: WorkspaceStore;
  private readonly transport: WorkspaceTransport;
  private readonly onFailure: (errors: string[]) => void;
  private readonly clientId = crypto.randomUUID();
  private acked: { revision: number; document: WorkspaceDocument };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<void> | null = null;
  private stopped = false;
  private disposers: (() => void)[] = [];

  constructor(
    workspace: WorkspaceStore,
    initial: { revision: number; document: WorkspaceDocument },
    transport: WorkspaceTransport,
    onFailure: (errors: string[]) => void,
  ) {
    this.workspace = workspace;
    this.acked = initial;
    this.transport = transport;
    this.onFailure = onFailure;
  }

  start(): void {
    this.disposers.push(
      this.workspace.subscribe(() => this.schedule()),
      this.transport.watch(
        ({ clientId: _clientId, ...revision }) => void this.onRemote(revision),
        () => void this.resync(),
      ),
    );
    // Edits made before start still need a first push.
    this.schedule();
  }

  dispose(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  /** Send pending edits now; resolves when the server has acknowledged them. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    while (this.inflight) await this.inflight;
    const ops = this.pendingOps();
    if (ops.length === 0 || this.stopped) return;
    this.inflight = this.send(ops).finally(() => (this.inflight = null));
    await this.inflight;
  }

  private schedule(): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SYNC_DEBOUNCE_MS);
  }

  private pendingOps(): JsonPatchOp[] {
    return createPatch(this.acked.document, this.workspace.snapshot());
  }

  private async send(ops: JsonPatchOp[]): Promise<void> {
    const sent = this.workspace.snapshot();
    const outcome = await this.transport.patch(this.acked.revision, ops, this.clientId);
    if (outcome.kind === "accepted") {
      this.acked = { revision: outcome.revision, document: sent };
      return;
    }
    if (outcome.kind === "conflict") {
      this.rebaseOnto(outcome.snapshot.revision, outcome.snapshot.document, ops);
      this.schedule();
      return;
    }
    this.fail(outcome.errors);
  }

  /** Own echoes are already acknowledged. */
  private async onRemote(change: WorkspaceRevision): Promise<void> {
    if (this.stopped) return;
    while (this.inflight) await this.inflight;
    if (change.revision <= this.acked.revision) return;
    if (change.revision !== this.acked.revision + 1) return this.resync();
    const server = applyWorkspaceOps(this.acked.document, change.ops);
    if (!server.ok) return this.resync();
    this.rebaseOnto(change.revision, server.value, this.pendingOps());
  }

  /** Re-read the authoritative snapshot after a gap or a lost connection. */
  private async resync(): Promise<void> {
    if (this.stopped) return;
    while (this.inflight) await this.inflight;
    const snapshot = await this.transport.snapshot();
    if (snapshot.revision === this.acked.revision) return;
    this.rebaseOnto(snapshot.revision, snapshot.document, this.pendingOps());
  }

  /**
   * Adopt `document` at `revision` as acknowledged, replay `pending` on top,
   * and load the result. If the replay no longer validates, local edits are
   * dropped in favour of the server document.
   */
  private rebaseOnto(revision: number, document: unknown, pending: JsonPatchOp[]): void {
    const server = decodeWorkspaceDocument(document);
    if (!server.ok) return this.fail(server.errors);
    this.acked = { revision, document: server.state };

    const replayed = pending.length > 0 ? applyWorkspaceOps(this.acked.document, pending) : null;
    const rebased = replayed?.ok ? decodeWorkspaceDocument(replayed.value) : null;
    if (replayed && !rebased?.ok) {
      console.warn("[workspace] local edits conflicted with a newer revision and were discarded");
    }
    this.workspace.applyDocument(rebased?.ok ? rebased.state : server.state);
  }

  private fail(errors: string[]): void {
    this.dispose();
    this.onFailure(errors);
  }
}

/** PATCH answers: 200 `{ revision }`, 409 snapshot, 400 problem. */
async function patchWorkspace(body: object): Promise<PatchOutcome> {
  const res = await fetch("/api/workspace", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json();
  if (res.ok) return { kind: "accepted", revision: WorkspacePatchAcceptedSchema.parse(json).revision };
  if (res.status === 409) return { kind: "conflict", snapshot: WorkspaceConflictSchema.parse(json) };
  const problem = WorkspaceProblemSchema.safeParse(json);
  return {
    kind: "invalid",
    errors: problem.success
      ? problem.data.errors.map((issue) => `${issue.pointer}: ${issue.detail}`)
      : [`workspace write failed: HTTP ${res.status}`],
  };
}

/** HTTP + WebSocket transport against the running ndea server. */
export function createHttpWorkspaceTransport(ws: {
  subscribe(
    method: "workspace/watch",
    req: Record<string, never>,
    onData: (change: WorkspaceChange) => void,
    onError?: (error: Error) => void,
  ): { unsubscribe(): void };
}): WorkspaceTransport {
  return {
    patch: (baseRevision, ops, clientId) => patchWorkspace({ baseRevision, ops, clientId }),
    watch(onChange, onLost) {
      let sub: { unsubscribe(): void };
      // The socket reconnects on its own; re-subscribe and re-read whatever was missed.
      const open = () => {
        sub = ws.subscribe("workspace/watch", {}, onChange, () => {
          open();
          onLost();
        });
      };
      open();
      return () => sub.unsubscribe();
    },
    snapshot: fetchWorkspaceSnapshot,
  };
}

export async function fetchWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const res = await fetch("/api/workspace");
  if (!res.ok) throw new Error(`workspace load failed: HTTP ${res.status}`);
  return WorkspaceSnapshotSchema.parse(await res.json());
}
