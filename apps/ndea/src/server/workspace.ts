/**
 * Server-owned workspace document: one revisioned document per session,
 * persisted atomically to a JSON file. A missing file is seeded from the
 * preset document. Every writer (browser sync, CLI, agents) goes through `apply`.
 */

import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { JsonPatchOp, WorkspaceChange, WorkspaceSnapshot } from "@ndea/protocol";
import {
  WORKSPACE_FORMAT,
  WORKSPACE_FORMAT_VERSION,
  applyWorkspaceOps,
  emptyWorkspaceDocument,
  parseWorkspaceDocument,
  parseWorkspaceFile,
  type WorkspaceIssue,
} from "../frontend/core/workspace/document.ts";
import type { WorkspaceDocument } from "../frontend/core/workspace/types.ts";

export type WorkspaceApplyResult =
  | { kind: "accepted"; revision: number }
  | { kind: "conflict"; snapshot: WorkspaceSnapshot }
  | { kind: "invalid"; issues: WorkspaceIssue[] };

export class WorkspaceFileError extends Error {
  readonly issues: readonly WorkspaceIssue[];
  constructor(path: string, issues: readonly WorkspaceIssue[]) {
    const lines = issues.map((issue) => `  ${issue.pointer || "/"}: ${issue.detail}`);
    super(`Invalid workspace file ${path}:\n${lines.join("\n")}`);
    this.issues = issues;
  }
}

export class WorkspaceDocumentStore {
  readonly path: string;
  private revision: number;
  private document: WorkspaceDocument;
  private readonly listeners = new Set<(change: WorkspaceChange) => void>();
  /** Applies run one at a time so two writers can never both pass the revision check. */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(path: string, revision: number, document: WorkspaceDocument) {
    this.path = path;
    this.revision = revision;
    this.document = document;
  }

  /** A revision-0 store over `document` that writes to `path` on first accepted patch; nothing is read. */
  static empty(path: string, document = emptyWorkspaceDocument()): WorkspaceDocumentStore {
    return new WorkspaceDocumentStore(path, 0, document);
  }

  /** Open `path`; a missing file is written from `seed()` as revision 1. Invalid files throw. */
  static async open(path: string, seed: () => Promise<WorkspaceDocument>): Promise<WorkspaceDocumentStore> {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      const document = await seed();
      await writeWorkspaceFile(path, 1, document);
      return new WorkspaceDocumentStore(path, 1, document);
    }
    let json: unknown;
    try {
      json = await file.json();
    } catch (error) {
      throw new WorkspaceFileError(path, [
        { pointer: "", detail: error instanceof Error ? error.message : String(error) },
      ]);
    }
    const parsed = parseWorkspaceFile(json);
    if (!parsed.ok) throw new WorkspaceFileError(path, parsed.issues);
    return new WorkspaceDocumentStore(path, parsed.value.revision, parsed.value.document);
  }

  snapshot(): WorkspaceSnapshot {
    return { revision: this.revision, document: this.document };
  }

  /**
   * Validate and apply `ops` against `baseRevision`. Resolves after the file
   * is written; a failed write rejects and leaves the document unchanged.
   */
  apply(
    baseRevision: number,
    ops: readonly JsonPatchOp[],
    clientId?: string,
    validate?: (document: WorkspaceDocument) => Promise<WorkspaceIssue[]>,
  ): Promise<WorkspaceApplyResult> {
    const run = this.queue.then(() => this.applyNow(baseRevision, ops, clientId, validate));
    this.queue = run.catch(() => {});
    return run;
  }

  private async applyNow(
    baseRevision: number,
    ops: readonly JsonPatchOp[],
    clientId: string | undefined,
    validate: ((document: WorkspaceDocument) => Promise<WorkspaceIssue[]>) | undefined,
  ): Promise<WorkspaceApplyResult> {
    if (baseRevision !== this.revision) return { kind: "conflict", snapshot: this.snapshot() };
    const applied = applyWorkspaceOps(this.document, ops);
    if (!applied.ok) return { kind: "invalid", issues: applied.issues };
    const parsed = parseWorkspaceDocument(applied.value);
    if (!parsed.ok) return { kind: "invalid", issues: parsed.issues };
    const issues = validate ? await validate(parsed.value) : [];
    if (issues.length) return { kind: "invalid", issues };

    await writeWorkspaceFile(this.path, this.revision + 1, parsed.value);
    this.document = parsed.value;
    this.revision += 1;
    const change: WorkspaceChange = { revision: this.revision, ops: [...ops], ...(clientId ? { clientId } : {}) };
    for (const listener of this.listeners) listener(change);
    return { kind: "accepted", revision: this.revision };
  }

  watch(listener: (change: WorkspaceChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Atomic tmp-and-rename write of the versioned workspace file. */
async function writeWorkspaceFile(path: string, revision: number, document: WorkspaceDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await Bun.write(
    tmp,
    JSON.stringify({ format: WORKSPACE_FORMAT, version: WORKSPACE_FORMAT_VERSION, revision, document }, null, 2),
  );
  await rename(tmp, path);
}
