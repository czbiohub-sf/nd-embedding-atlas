/**
 * The served session and the one way to replace it: a collection switch
 * (`POST /api/collection`). One transition runs at a time: clear every filter
 * scope's `dataset` source (a `system` revision), open the new session beside
 * the old one, make it current, tell the `onChange` listeners (the server
 * reloads its routes on the same port, `/ws` pushes `session/watch`), then
 * close the old store. The workspace and harness carry over: every session
 * shares them.
 */

import type { WorkspaceDocument } from "../frontend/core/workspace/types.ts";
import { escapePointer } from "./observation-sets.ts";
import type { DatasetSessionMetadata, ServerSession } from "./state.ts";
import type { Workspace } from "./workspace.ts";

export interface HostedSession {
  state: ServerSession;
  metadata: DatasetSessionMetadata;
}

export type CollectionSwitch = { kind: "switched" } | { kind: "unknown" } | { kind: "busy"; target: string };

export class SessionHost {
  private session: HostedSession;
  private switching: string | null = null;
  private readonly listeners = new Set<(session: HostedSession) => void>();
  /** Ingest one collection into a fresh session. */
  private readonly open: (collection: string) => Promise<HostedSession>;

  constructor(session: HostedSession, open: (collection: string) => Promise<HostedSession>) {
    this.session = session;
    this.open = open;
  }

  get current(): HostedSession {
    return this.session;
  }

  /** Serve collection `name`; the open one is already served. Refused while another switch runs. */
  async switchTo(name: string): Promise<CollectionSwitch> {
    const { status, workspace } = this.session.state;
    if (!status.collections.some((c) => c.name === name)) return { kind: "unknown" };
    if (name === status.collection) return { kind: "switched" };
    if (this.switching) return { kind: "busy", target: this.switching };
    this.switching = name;
    try {
      console.log(`Switching to collection ${name}`);
      await clearDatasetFilters(workspace);
      const next = await this.open(name);
      const previous = this.session;
      this.session = next;
      for (const listener of this.listeners) listener(next);
      previous.state.cropPool?.dispose();
      previous.state.store.close();
      return { kind: "switched" };
    } finally {
      this.switching = null;
    }
  }

  /** Call `listener` with each new session, in subscription order, until the returned dispose. */
  onChange(listener: (session: HostedSession) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * Drop every filter scope's `dataset` source (the Data panel's and ⌘K's dataset filter): its
 * clause names the old collection's datasets, so it would select nothing, or no `_dataset` column, in another.
 */
async function clearDatasetFilters(workspace: Workspace): Promise<void> {
  const { revision, document } = workspace.get();
  const filter = (document as WorkspaceDocument | null)?.state.filter ?? {};
  const ops = Object.keys(filter)
    .filter((scope) => filter[scope].dataset)
    .map((scope) => ({ op: "remove" as const, path: `/state/filter/${escapePointer(scope)}/dataset` }));
  if (ops.length === 0) return;
  const result = await workspace.patch(ops, { base: revision, actor: { kind: "system" } });
  if (result.kind !== "accepted") console.warn(`could not clear the dataset filter (${result.kind})`);
}
