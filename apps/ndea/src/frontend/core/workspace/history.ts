/**
 * Browser read model of the server's revision history: the newest page from
 * `/api/workspace/history` plus every revision `WorkspaceSync` sees live.
 * Restore is a server commit (`WorkspaceSync.restore`); the resulting watch
 * event updates the document through the normal sync path.
 */

import {
  WorkspaceHistorySchema,
  WorkspaceSnapshotSchema,
  type WorkspaceActor,
  type WorkspaceRevision,
} from "@ndea/protocol";
import { createPatch } from "rfc6902";

import type { PatchOutcome, WorkspaceSync } from "./sync";

export class WorkspaceHistory {
  private sync: WorkspaceSync | null = null;
  private revisions: readonly WorkspaceRevision[] = [];
  private readonly documents = new Map<number, Promise<unknown>>();
  private readonly listeners = new Set<() => void>();
  /** Live revisions another writer (agent, CLI, other tab) committed. */
  private readonly remote = new Set<number>();

  /** Follow `sync`'s revisions and restore through it until the returned disconnect. */
  connect(sync: WorkspaceSync): () => void {
    this.sync = sync;
    const stop = sync.onRevision((revision, own) => {
      if (!own) this.remote.add(revision.revision);
      this.merge([revision]);
    });
    // ponytail: newest 50 only; page with `before` when the panel needs older revisions.
    void fetch("/api/workspace/history?limit=50")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.merge(WorkspaceHistorySchema.parse(await res.json()).revisions);
      })
      .catch((error: unknown) => console.warn("[workspace] history load failed", error));
    return () => {
      stop();
      if (this.sync === sync) this.sync = null;
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Newest first; a stable array until the next revision arrives. */
  list = (): readonly WorkspaceRevision[] => this.revisions;

  /** Whether `revision` arrived live from another writer. */
  isRemote(revision: number): boolean {
    return this.remote.has(revision);
  }

  /** The document as of `revision`, cached. */
  at(revision: number): Promise<unknown> {
    let document = this.documents.get(revision);
    if (!document) {
      document = fetch(`/api/workspace/revisions/${revision}`).then(async (res) => {
        if (!res.ok) throw new Error(`revision ${revision}: HTTP ${res.status}`);
        return WorkspaceSnapshotSchema.parse(await res.json()).document;
      });
      void document.catch(() => this.documents.delete(revision));
      this.documents.set(revision, document);
    }
    return document;
  }

  restore(revision: number): Promise<PatchOutcome> {
    if (!this.sync) return Promise.reject(new Error("the workspace is read-only"));
    return this.sync.restore(revision);
  }

  private merge(incoming: readonly WorkspaceRevision[]): void {
    const byRevision = new Map(this.revisions.map((r) => [r.revision, r]));
    for (const r of incoming) byRevision.set(r.revision, r);
    this.revisions = [...byRevision.values()].toSorted((a, b) => b.revision - a.revision);
    for (const listener of this.listeners) listener();
  }
}

/** `omp`, `browser`, `cli`, `system`, or `mcp` for an unnamed agent. */
export function actorLabel(actor: WorkspaceActor): string {
  return actor.agent ?? actor.kind;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
];
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

export function relativeTime(iso: string, now: number): string {
  // A revision stamped after the caller's last clock tick reads as "now", never "in 2s".
  const delta = Math.min(0, Date.parse(iso) - now);
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms || unit === "second") return relative.format(Math.round(delta / ms), unit);
  }
  return "";
}

export interface DocumentChange {
  section: "element" | "data" | "state" | "spec";
  key: string;
  change: "added" | "removed" | "type" | "props" | "children" | "changed";
}

const ELEMENT_FIELDS = new Set(["type", "props", "children"]);

/**
 * Element-level summary of what differs from `before` to `after`: elements
 * added, removed, retyped, or with changed props or children; data sources and
 * state cells (`<type>/<scope>`) added, removed, or changed.
 */
export function compareDocuments(before: unknown, after: unknown): DocumentChange[] {
  const changes = new Map<string, DocumentChange>();
  for (const op of createPatch(before, after)) {
    const path = op.path
      .split("/")
      .slice(1)
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
    const element = path[0] === "spec" && path[1] === "elements" && path.length > 2;
    // Path length of the item itself: an op exactly there adds or removes it; deeper ops change it.
    const [section, depth]: [DocumentChange["section"], number] = element
      ? ["element", 3]
      : path[0] === "data"
        ? ["data", 2]
        : path[0] === "state"
          ? ["state", 3]
          : ["spec", 2];
    const field = path[depth] ?? "";
    const change: DocumentChange["change"] =
      path.length > depth
        ? element && ELEMENT_FIELDS.has(field)
          ? (field as DocumentChange["change"])
          : "changed"
        : op.op === "add"
          ? "added"
          : op.op === "remove"
            ? "removed"
            : "changed";
    const key = path.slice(element ? 2 : 1, depth).join("/");
    changes.set(`${section}\0${key}\0${change}`, { section, key, change });
  }
  return [...changes.values()];
}
