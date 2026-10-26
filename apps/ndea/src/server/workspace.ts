/**
 * The session's one workspace document and its revision history. Every
 * writer (browser sync, CLI, agents) goes through `patch` or `restore`:
 * writes run one at a time, pass the structural checks and then the injected
 * `validate`, and commit the history row and the JSON file together before
 * any watcher hears of them. History lives beside the JSON file in
 * `<name>.history.sqlite`; the JSON file format is unchanged.
 */

import { Database } from "bun:sqlite";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
  JsonPatchOpSchema,
  type JsonPatchOp,
  type WorkspaceActor,
  type WorkspaceChange,
  type WorkspaceRevision,
  type WorkspaceSnapshot,
} from "@ndea/protocol";
import { createPatch } from "rfc6902";
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

export type WorkspacePatchResult =
  | { kind: "accepted"; revision: number }
  | { kind: "conflict"; snapshot: WorkspaceSnapshot }
  | { kind: "invalid"; issues: WorkspaceIssue[] };

/** Dataset-dependent checks (set references, columns) run after the structural ones. */
export type WorkspaceValidate = (document: WorkspaceDocument) => Promise<WorkspaceIssue[]>;

export interface WorkspaceWrite {
  base: number;
  actor: WorkspaceActor;
  /** The writer's echo token, passed through to watchers. */
  clientId?: string;
}

export class WorkspaceFileError extends Error {
  readonly issues: readonly WorkspaceIssue[];
  constructor(path: string, issues: readonly WorkspaceIssue[]) {
    const lines = issues.map((issue) => `  ${issue.pointer || "/"}: ${issue.detail}`);
    super(`Invalid workspace file ${path}:\n${lines.join("\n")}`);
    this.issues = issues;
  }
}

interface Row {
  revision: number;
  base: number;
  actor_kind: WorkspaceActor["kind"];
  actor_agent: string | null;
  ops: string;
  committed_at: string;
  restored_from: number | null;
}

// ponytail: unbounded retention; prune by count/age when files grow.
const SCHEMA = `CREATE TABLE IF NOT EXISTS revisions (
  revision INTEGER PRIMARY KEY,
  base INTEGER NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_agent TEXT,
  ops TEXT NOT NULL,
  document TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  restored_from INTEGER
)`;
const COLUMNS = "revision, base, actor_kind, actor_agent, ops, committed_at, restored_from";

export class Workspace {
  readonly path: string;
  /** The file stem: the `<name>` in `ndea://<name>/<element-id>` references. */
  readonly name: string;
  private revision = 0;
  private document: WorkspaceDocument;
  private readonly db: Database;
  private readonly validate: WorkspaceValidate;
  private readonly persist: (revision: number, document: WorkspaceDocument) => void;
  private readonly listeners = new Set<(change: WorkspaceChange) => void>();
  /** Writes run one at a time so two writers can never both pass the revision check. */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    path: string,
    document: WorkspaceDocument,
    db: Database,
    validate: WorkspaceValidate,
    persist: (revision: number, document: WorkspaceDocument) => void,
  ) {
    this.path = path;
    this.name = basename(path, ".json");
    this.document = deepFreeze(document);
    this.db = db;
    this.validate = validate;
    this.persist = persist;
    db.run(SCHEMA);
  }

  /** A revision-0 workspace with in-memory history and no file, for tests. */
  static memory(
    document: WorkspaceDocument = emptyWorkspaceDocument(),
    { validate = async () => [] }: { validate?: WorkspaceValidate } = {},
  ): Workspace {
    return new Workspace(":memory:", document, new Database(":memory:"), validate, () => {});
  }

  /**
   * Open `path`; a missing file is written from `seed()` as revision 1. Invalid
   * files throw, and so does any other format version (no migrations: deleting
   * the file reseeds it from the preset). When the history lacks the current
   * revision (a new history file, or the JSON was replaced), a `system`
   * baseline row records it.
   */
  static async open(
    path: string,
    seed: () => Promise<WorkspaceDocument>,
    { validate }: { validate: WorkspaceValidate },
  ): Promise<Workspace> {
    const file = Bun.file(path);
    let opened: { revision: number; document: WorkspaceDocument } | undefined;
    if (await file.exists()) {
      let json: unknown;
      try {
        json = await file.json();
      } catch (error) {
        throw new WorkspaceFileError(path, [
          { pointer: "", detail: error instanceof Error ? error.message : String(error) },
        ]);
      }
      const version = (json as { version?: unknown } | null)?.version;
      if (version !== WORKSPACE_FORMAT_VERSION) {
        throw new WorkspaceFileError(path, [
          {
            pointer: "/version",
            detail: `format version ${JSON.stringify(version)} is not supported (this ndea reads version ${WORKSPACE_FORMAT_VERSION}); delete ${path} to reseed it from the preset`,
          },
        ]);
      }
      const parsed = parseWorkspaceFile(json);
      if (!parsed.ok) throw new WorkspaceFileError(path, parsed.issues);
      opened = parsed.value;
    }
    const document = opened?.document ?? (await seed());
    mkdirSync(dirname(path), { recursive: true });
    const history = new Database(`${path.replace(/\.json$/, "")}.history.sqlite`);
    const workspace = new Workspace(path, document, history, validate, (revision, doc) =>
      writeWorkspaceFile(path, revision, doc),
    );
    workspace.baseline(opened?.revision ?? 1, !opened);
    return workspace;
  }

  /** The accepted snapshot; its document is deep-frozen, so callers read it but never mutate it. */
  get(): WorkspaceSnapshot {
    return { revision: this.revision, document: this.document, name: this.name };
  }

  /** The document as committed at `revision`, if history has it. */
  at(revision: number): WorkspaceSnapshot | undefined {
    const row = this.db
      .query<{ document: string }, [number]>("SELECT document FROM revisions WHERE revision = ?")
      .get(revision);
    return row ? { revision, document: JSON.parse(row.document), name: this.name } : undefined;
  }

  /** Committed revisions, newest first, older than `before`. */
  history({ before, limit = 50 }: { before?: number; limit?: number } = {}): WorkspaceRevision[] {
    return this.db
      .query<Row, [number, number]>(
        `SELECT ${COLUMNS} FROM revisions WHERE revision < ? ORDER BY revision DESC LIMIT ?`,
      )
      .all(before ?? Number.MAX_SAFE_INTEGER, limit)
      .map(toRevision);
  }

  /** Validate and commit `ops` against `base`. A failed file write rejects and changes nothing. */
  patch(ops: readonly JsonPatchOp[], write: WorkspaceWrite): Promise<WorkspacePatchResult> {
    return this.enqueue(() => this.patchNow(ops, write));
  }

  /** Every issue `document` would raise as the next revision, without committing it. */
  async check(document: unknown): Promise<WorkspaceIssue[]> {
    const parsed = parseWorkspaceDocument(document);
    return parsed.ok ? this.validate(parsed.value) : parsed.issues;
  }

  /** Commit the document at `revision` as a new revision, diffed against the current one. */
  restore(revision: number, write: WorkspaceWrite): Promise<WorkspacePatchResult | { kind: "not-found" }> {
    return this.enqueue<WorkspacePatchResult | { kind: "not-found" }>(() => {
      const target = this.at(revision);
      if (!target) return { kind: "not-found" };
      const ops = JsonPatchOpSchema.array().parse(createPatch(this.document, target.document));
      // Already identical: nothing to commit, but a stale base still conflicts below.
      if (ops.length === 0 && write.base === this.revision) return { kind: "accepted", revision: this.revision };
      return this.patchNow(ops, write, revision);
    });
  }

  watch(listener: (change: WorkspaceChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private enqueue<T>(run: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => {});
    return next;
  }

  private async patchNow(
    ops: readonly JsonPatchOp[],
    { base, actor, clientId }: WorkspaceWrite,
    restoredFrom?: number,
  ): Promise<WorkspacePatchResult> {
    if (base !== this.revision) return { kind: "conflict", snapshot: this.get() };
    const applied = applyWorkspaceOps(this.document, ops);
    if (!applied.ok) return { kind: "invalid", issues: applied.issues };
    const parsed = parseWorkspaceDocument(applied.value);
    if (!parsed.ok) return { kind: "invalid", issues: parsed.issues };
    const issues = await this.validate(parsed.value);
    if (issues.length) return { kind: "invalid", issues };

    const record: WorkspaceRevision = {
      revision: this.revision + 1,
      baseRevision: this.revision,
      actor,
      ops: [...ops],
      committedAt: new Date().toISOString(),
      ...(restoredFrom ? { restoredFrom } : {}),
    };
    // Row, then file, then commit: a failed write throws and rolls the row back.
    this.db.transaction(() => {
      this.insert(record, parsed.value);
      this.persist(record.revision, parsed.value);
    })();
    this.revision = record.revision;
    this.document = deepFreeze(parsed.value);
    const change: WorkspaceChange = clientId ? { ...record, clientId } : record;
    for (const listener of this.listeners) listener(change);
    return { kind: "accepted", revision: record.revision };
  }

  /** Make history agree with the opened document at `revision`; `write` also writes the file (seeding). */
  private baseline(revision: number, write: boolean): void {
    this.revision = revision;
    const json = JSON.stringify(this.document);
    const stored = this.db
      .query<{ document: string }, [number]>("SELECT document FROM revisions WHERE revision = ?")
      .get(revision);
    this.db.transaction(() => {
      // Rows past the file's revision describe a future the file no longer has.
      this.db.run("DELETE FROM revisions WHERE revision > ?", [revision]);
      if (stored?.document !== json) {
        const actor = { kind: "system" } as const;
        this.insert(
          { revision, baseRevision: revision - 1, actor, ops: [], committedAt: new Date().toISOString() },
          this.document,
        );
      }
      if (write) this.persist(revision, this.document);
    })();
  }

  private insert(record: WorkspaceRevision, document: WorkspaceDocument): void {
    this.db
      .query(`INSERT OR REPLACE INTO revisions (${COLUMNS}, document) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        record.revision,
        record.baseRevision,
        record.actor.kind,
        record.actor.agent ?? null,
        JSON.stringify(record.ops),
        record.committedAt,
        record.restoredFrom ?? null,
        JSON.stringify(document),
      );
  }
}

function toRevision(row: Row): WorkspaceRevision {
  return {
    revision: row.revision,
    baseRevision: row.base,
    actor: { kind: row.actor_kind, ...(row.actor_agent ? { agent: row.actor_agent } : {}) },
    ops: JSON.parse(row.ops),
    committedAt: row.committed_at,
    ...(row.restored_from ? { restoredFrom: row.restored_from } : {}),
  };
}

/** Freeze a JSON value in place; ops apply to a `structuredClone` (`applyWorkspaceOps`), never to this. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Atomic tmp-and-rename write of the versioned workspace file. */
function writeWorkspaceFile(path: string, revision: number, document: WorkspaceDocument): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(
    tmp,
    JSON.stringify({ format: WORKSPACE_FORMAT, version: WORKSPACE_FORMAT_VERSION, revision, document }, null, 2),
  );
  renameSync(tmp, path);
}
