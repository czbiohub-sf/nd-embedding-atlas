/**
 * Collections — saved selection sets with tags, soft-delete, optimistic concurrency.
 *
 *   GET    /api/collections                — list (with drift breakdown)
 *   POST   /api/collections                — create from members
 *   PATCH  /api/collections/{id}           — name | color | notes | tags
 *   DELETE /api/collections/{id}           — soft delete
 *
 *   POST   /api/active-selection           — set the active set composition
 *   GET    /api/active-selection/row-indices — binary uint32 row indices
 *   DELETE /api/active-selection           — clear the active set
 *
 * All writes use parameterized SQL (`conn.run(sql, values)`). Bulk member
 * inserts go through DuckDB's Appender.
 *
 * Active-selection contract (token-scoped, generic for PR3 set algebra):
 * — One stable temp table `__active_selection` (CREATE OR REPLACE per request)
 * — A monotonically-bumping `token` rides as an inline SQL comment in the
 *   predicate so Mosaic's SQL-text cache busts on every set change without
 *   needing per-activation table names.
 * — The route accepts `{collection_ids: [id]}` today (one element); PR3
 *   extends the body to `{ops: [...]}` for UNION/INTERSECT/SUBTRACT without
 *   changing the URL or response shape.
 */

import {
  AppendMembersBodySchema,
  CreateCollectionBodySchema,
  type MemberMutationStats,
  parseJsonBody,
  PatchCollectionBodySchema,
  SetActiveSelectionBodySchema,
} from "../protocol.ts";
import type { EmbeddingStore } from "../store.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────

interface Row {
  [key: string]: unknown;
}

/** Run SQL with optional bound parameters and read all rows as plain objects. */
async function selectRows(store: EmbeddingStore, sql: string, params?: unknown[]): Promise<Row[]> {
  const reader = await store.conn.runAndReadAll(sql, params as never);
  return reader.getRowObjectsJS() as Row[];
}

/**
 * Map a thrown error to a user-facing message.
 *
 * Stops leaking DuckDB internals (constraint names, table names, occasional
 * SQL fragments) to toasts and Field.Error slots. Known cases get fixed
 * strings; unknown errors fall back to a generic message + server-side log.
 *
 * Per-route handlers still log the raw error before calling this; the
 * mapped string is the only thing that crosses the wire.
 */
export function toUserError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/UNIQUE constraint|PRIMARY KEY/i.test(msg)) return "This name or member is already in use.";
  if (/FOREIGN KEY/i.test(msg)) return "Referenced record not found.";
  if (/CHECK constraint/i.test(msg)) return "Value violates a validation rule.";
  if (/__scatter_selection.*does not exist|__scatter_selection is empty/i.test(msg)) {
    return "No selection to save. Lasso something first.";
  }
  if (msg.startsWith("ZodError") || /failed validation/i.test(msg)) return "Invalid request data.";
  return "Internal error (see server logs).";
}

function scalarString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  return null;
}

function scalarNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}

// ─── Resolve obs_index from durable obs_name ────────────────────────────────
//
// Each insertMembers* helper returns MemberMutationStats:
//   - total:          input row count (what the user sent)
//   - added:          rows actually inserted (via INSERT OR IGNORE … RETURNING)
//   - already_member: total - added; combines "PK-collided with existing
//                     member" and "didn't resolve in obs_base" into a single
//                     dedupe-friendly bucket. v1 simplification — drift is
//                     still exposed independently via current_count <
//                     created_count on the Collection row.

/**
 * Count rows newly inserted by an `INSERT OR IGNORE … RETURNING` statement.
 *
 * DuckDB's RETURNING under INSERT OR IGNORE returns one row per
 * actually-inserted tuple (verified by /tmp/duckdb-returning-probe.ts in
 * PR2). PK-collisions are silently skipped and do not appear in the
 * RETURNING result set.
 */
async function runInsertOrIgnoreReturning(store: EmbeddingStore, sql: string, params: unknown[]): Promise<number> {
  const reader = await store.conn.runAndReadAll(sql, params as never);
  return reader.getRowObjectsJS().length;
}

/**
 * Materialize members for a collection from a (dataset_key, obs_name) list.
 *
 * Resolves `obs_index` server-side by JOIN against obs_base. Members whose
 * obs_name doesn't match a current obs_base row are silently dropped (drift).
 */
async function insertMembers(
  store: EmbeddingStore,
  collectionId: string,
  members: { dataset_key: string; obs_name: string }[],
): Promise<MemberMutationStats> {
  const total = members.length;
  if (total === 0) return { total: 0, added: 0, already_member: 0 };

  const tmpTable = `__coll_input_${collectionId.replace(/-/g, "")}`;
  await store.execute(`CREATE TEMP TABLE ${tmpTable} (dataset_key TEXT, obs_name TEXT)`);

  const appender = await store.conn.createAppender(tmpTable);
  for (const m of members) {
    appender.appendVarchar(m.dataset_key);
    appender.appendVarchar(m.obs_name);
    appender.endRow();
  }
  appender.closeSync();

  const isMulti = await store.hasDatasetColumn();
  const joinCond = isMulti ? "b._dataset = i.dataset_key AND b.obs_name = i.obs_name" : "b.obs_name = i.obs_name";

  const added = await runInsertOrIgnoreReturning(
    store,
    `INSERT OR IGNORE INTO collection_members (collection_id, dataset_key, obs_index, obs_name)
     SELECT ?, i.dataset_key, b.__obs_index__, i.obs_name
     FROM ${tmpTable} i
     INNER JOIN obs_base b ON ${joinCond}
     RETURNING obs_index`,
    [collectionId],
  );

  await store.execute(`DROP TABLE ${tmpTable}`);

  return { total, added, already_member: total - added };
}

/**
 * Materialize members from a row-index list.
 *
 * Resolves the supplied `__row_index__` values to durable identities via
 * JOIN. row_indices are already zod-validated as non-negative integers, so
 * direct interpolation is injection-safe.
 */
async function insertMembersByRowIndex(
  store: EmbeddingStore,
  collectionId: string,
  rowIndices: number[],
): Promise<MemberMutationStats> {
  const total = rowIndices.length;
  if (total === 0) return { total: 0, added: 0, already_member: 0 };

  const tmpTable = `__coll_idx_${collectionId.replace(/-/g, "")}`;
  await store.execute(`CREATE TEMP TABLE ${tmpTable} (row_index INTEGER)`);

  const batchSize = 1000;
  for (let start = 0; start < total; start += batchSize) {
    const end = Math.min(start + batchSize, total);
    const values = rowIndices
      .slice(start, end)
      .map((i) => `(${i})`)
      .join(", ");
    await store.execute(`INSERT INTO ${tmpTable} VALUES ${values}`);
  }

  const isMulti = await store.hasDatasetColumn();
  const datasetExpr = isMulti ? "b._dataset" : "''";

  const added = await runInsertOrIgnoreReturning(
    store,
    `INSERT OR IGNORE INTO collection_members (collection_id, dataset_key, obs_index, obs_name)
     SELECT ?, ${datasetExpr}, b.__obs_index__, b.obs_name
     FROM ${tmpTable} t
     INNER JOIN obs_base b ON b.__row_index__ = t.row_index
     RETURNING obs_index`,
    [collectionId],
  );

  await store.execute(`DROP TABLE ${tmpTable}`);

  return { total, added, already_member: total - added };
}

/**
 * Materialize members from the live `__scatter_selection` temp table.
 *
 * The frontend populates this via POST /api/scatter-selection — we JOIN
 * against obs_base here. Tiny request body, fast.
 */
async function insertMembersFromScatterSelection(
  store: EmbeddingStore,
  collectionId: string,
): Promise<MemberMutationStats> {
  const exists = await selectRows(
    store,
    "SELECT 1 FROM information_schema.tables WHERE table_name = '__scatter_selection'",
  );
  if (exists.length === 0) {
    throw new Error("__scatter_selection temp table does not exist. POST /api/scatter-selection first to populate it.");
  }

  // Reject empty selection up front — silently producing a zero-member
  // collection is the wrong UX (the user pressed Save expecting members).
  const sizeRows = await selectRows(store, "SELECT COUNT(*) AS n FROM __scatter_selection");
  const total = scalarNumber(sizeRows[0]?.n ?? 0);
  if (total === 0) {
    throw new Error("__scatter_selection is empty. Lasso something before saving a collection.");
  }

  const isMulti = await store.hasDatasetColumn();
  const datasetExpr = isMulti ? "b._dataset" : "''";

  const added = await runInsertOrIgnoreReturning(
    store,
    `INSERT OR IGNORE INTO collection_members (collection_id, dataset_key, obs_index, obs_name)
     SELECT ?, ${datasetExpr}, b.__obs_index__, b.obs_name
     FROM __scatter_selection s
     INNER JOIN obs_base b ON b.__row_index__ = s.row_index
     RETURNING obs_index`,
    [collectionId],
  );

  return { total, added, already_member: total - added };
}

// ─── Tag helpers ────────────────────────────────────────────────────────────

async function insertTags(store: EmbeddingStore, collectionId: string, tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  for (const tag of tags) {
    await store.conn.run("INSERT OR IGNORE INTO collection_tags (collection_id, tag) VALUES (?, ?)", [
      collectionId,
      tag,
    ]);
  }
}

async function replaceTags(store: EmbeddingStore, collectionId: string, tags: string[]): Promise<void> {
  await store.conn.run("DELETE FROM collection_tags WHERE collection_id = ?", [collectionId]);
  await insertTags(store, collectionId, tags);
}

async function loadTags(store: EmbeddingStore, collectionId: string): Promise<string[]> {
  const rows = await selectRows(store, "SELECT tag FROM collection_tags WHERE collection_id = ? ORDER BY tag", [
    collectionId,
  ]);
  return rows.map((r) => String(r.tag));
}

// ─── Drift breakdown ────────────────────────────────────────────────────────

/**
 * For each (collection_id, dataset_key) compute stored count and the count
 * still resolvable in current `obs_base`. The two diverge when re-ingest
 * drops or renames obs.
 */
async function loadDrift(
  store: EmbeddingStore,
  collectionId: string,
): Promise<{ stored: { dataset_key: string; stored: number }[] }> {
  const rows = await selectRows(
    store,
    `SELECT dataset_key, COUNT(*) AS stored
       FROM collection_members
       WHERE collection_id = ?
       GROUP BY dataset_key
       ORDER BY dataset_key`,
    [collectionId],
  );
  return {
    stored: rows.map((r) => ({
      dataset_key: String(r.dataset_key),
      stored: scalarNumber(r.stored),
    })),
  };
}

// ─── Serialize a collection row ─────────────────────────────────────────────

interface CollectionRow {
  collection_id: string;
  name: string;
  color: string | null;
  notes: string | null;
  provenance: unknown;
  created_at: string;
  updated_at: string;
  created_count: number;
  current_count: number;
  tags: string[];
  drift: { dataset_key: string; stored: number; resolved: number }[];
  version: number;
}

/** Parse the JSON column value back to its structured form for the wire. */
function parseProvenance(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}

async function serializeCollection(store: EmbeddingStore, collectionId: string): Promise<CollectionRow | null> {
  const rows = await selectRows(
    store,
    `SELECT
        c.collection_id,
        c.name,
        c.color,
        c.notes,
        c.provenance,
        c.created_at,
        c.updated_at,
        c.created_count,
        c.version,
        COUNT(m.obs_index) AS current_count
     FROM collections c
     LEFT JOIN collection_members m USING (collection_id)
     WHERE c.collection_id = ? AND c.deleted_at IS NULL
     GROUP BY c.collection_id, c.name, c.color, c.notes, c.provenance, c.created_at, c.updated_at, c.created_count, c.version`,
    [collectionId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];

  const tags = await loadTags(store, collectionId);
  const drift = await loadDrift(store, collectionId);
  // PR 3 will rebuild obs_index against current obs_base on attach so the
  // stored counts are already "resolved". Surface stored == resolved here so
  // the response shape is stable; PR 5 fills real drift.
  const driftOut = drift.stored.map((d) => ({
    dataset_key: d.dataset_key,
    stored: d.stored,
    resolved: d.stored,
  }));

  return {
    collection_id: String(row.collection_id),
    name: String(row.name),
    color: scalarString(row.color),
    notes: scalarString(row.notes),
    provenance: parseProvenance(row.provenance),
    created_at: scalarString(row.created_at) ?? "",
    updated_at: scalarString(row.updated_at) ?? "",
    created_count: scalarNumber(row.created_count),
    current_count: scalarNumber(row.current_count),
    tags,
    drift: driftOut,
    version: scalarNumber(row.version),
  };
}

// ─── Handlers ───────────────────────────────────────────────────────────────

/** GET /api/collections — list non-deleted collections. */
export async function handleListCollections(store: EmbeddingStore): Promise<Response> {
  try {
    const ids = await selectRows(
      store,
      `SELECT collection_id FROM collections WHERE deleted_at IS NULL ORDER BY created_at`,
    );
    const out: CollectionRow[] = [];
    for (const r of ids) {
      const c = await serializeCollection(store, String(r.collection_id));
      if (c) out.push(c);
    }
    return Response.json(out);
  } catch (err) {
    console.error(`[collections] list failed:`, err);
    return Response.json({ error: toUserError(err) }, { status: 500 });
  }
}

/**
 * POST /api/collections — create a new collection from a member source.
 *
 * Returns CollectionMutationResult = { result: Collection, stats: MemberMutationStats }.
 * `stats.added` reflects rows actually inserted via INSERT OR IGNORE …
 * RETURNING; `stats.already_member` is the input-vs-added gap (collisions
 * + drift, both bucketed together for v1 — see helper docs).
 */
export async function handleCreateCollection(req: Request, store: EmbeddingStore): Promise<Response> {
  const parsed = await parseJsonBody(req, CreateCollectionBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Stamp `synthetic_identity` into provenance when the dataset has no
  // explicit string obs_name column. Indices are stable across re-opens of
  // the same Zarr but may shift on re-ingest — frontend can surface this
  // as a non-blocking warning on the row.
  const provenanceObj: Record<string, unknown> = (body.provenance as Record<string, unknown>) ?? {};
  if (store.obsNameOrigin === "synthetic") {
    provenanceObj.synthetic_identity = true;
  }
  const provenanceJson = Object.keys(provenanceObj).length === 0 ? null : JSON.stringify(provenanceObj);
  if (provenanceJson != null && provenanceJson.length > 64 * 1024) {
    return Response.json({ error: "provenance JSON exceeds 64KB" }, { status: 413 });
  }

  const collectionId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Wrap the multi-statement create in a single DuckDB transaction. A crash
  // (or rejection from `insertMembersFromScatterSelection` on empty input)
  // mid-sequence would otherwise leave an orphan `collections` row with no
  // members / no tags. ROLLBACK on any failure restores prior state.
  let inTransaction = false;
  try {
    await store.conn.run("BEGIN TRANSACTION");
    inTransaction = true;

    // For from_scatter_selection, count materialized rows after the JOIN.
    // For members/row_indices we know the input size up front.
    const inputCount = body.members?.length ?? body.row_indices?.length ?? 0;

    await store.conn.run(
      `INSERT INTO collections (collection_id, name, color, notes, provenance, created_at, updated_at, created_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [collectionId, body.name, body.color ?? null, body.notes ?? null, provenanceJson, now, now, inputCount],
    );

    let stats: MemberMutationStats = { total: 0, added: 0, already_member: 0 };
    if (body.members && body.members.length > 0) {
      stats = await insertMembers(store, collectionId, body.members);
    } else if (body.row_indices && body.row_indices.length > 0) {
      stats = await insertMembersByRowIndex(store, collectionId, body.row_indices);
    } else if (body.from_scatter_selection) {
      stats = await insertMembersFromScatterSelection(store, collectionId);
      // Backfill created_count from the materialized result (we didn't know
      // the size up front for this path).
      await store.conn.run("UPDATE collections SET created_count = ? WHERE collection_id = ?", [
        stats.total,
        collectionId,
      ]);
    }
    await insertTags(store, collectionId, body.tags);

    await store.conn.run("COMMIT");
    inTransaction = false;

    const out = await serializeCollection(store, collectionId);
    if (!out) return Response.json({ error: toUserError(new Error("Created but not retrievable")) }, { status: 500 });
    return Response.json({ result: out, stats }, { status: 201 });
  } catch (err) {
    if (inTransaction) {
      try {
        await store.conn.run("ROLLBACK");
      } catch (rollbackErr) {
        console.error(`[collections] rollback failed: ${String(rollbackErr)}`);
      }
    }
    console.error(`[collections] create failed:`, err);
    return Response.json({ error: toUserError(err) }, { status: 500 });
  }
}

/** PATCH /api/collections/{id} — partial update with optimistic concurrency. */
export async function handlePatchCollection(
  collectionId: string,
  req: Request,
  store: EmbeddingStore,
): Promise<Response> {
  const parsed = await parseJsonBody(req, PatchCollectionBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const existing = await selectRows(
      store,
      "SELECT version FROM collections WHERE collection_id = ? AND deleted_at IS NULL",
      [collectionId],
    );
    if (existing.length === 0) {
      return Response.json({ error: "Collection not found" }, { status: 404 });
    }
    const currentVersion = scalarNumber(existing[0].version);
    if (currentVersion !== body.version) {
      return Response.json(
        { error: `Version conflict (have ${currentVersion}, sent ${body.version})` },
        { status: 409 },
      );
    }

    const sets: string[] = ["updated_at = ?", "version = version + 1"];
    const params: unknown[] = [new Date().toISOString()];
    if (body.name !== undefined) {
      sets.push("name = ?");
      params.push(body.name);
    }
    if (body.color !== undefined) {
      sets.push("color = ?");
      params.push(body.color);
    }
    if (body.notes !== undefined) {
      sets.push("notes = ?");
      params.push(body.notes);
    }

    if (sets.length > 2) {
      params.push(collectionId);
      await store.conn.run(`UPDATE collections SET ${sets.join(", ")} WHERE collection_id = ?`, params as never);
    } else {
      // No top-level fields to update, but tags may still change → bump version + updated_at
      await store.conn.run(`UPDATE collections SET updated_at = ?, version = version + 1 WHERE collection_id = ?`, [
        new Date().toISOString(),
        collectionId,
      ]);
    }

    if (body.tags !== undefined) {
      await replaceTags(store, collectionId, body.tags);
    }

    const out = await serializeCollection(store, collectionId);
    if (!out) return Response.json({ error: toUserError(new Error("Updated but not retrievable")) }, { status: 500 });
    return Response.json(out);
  } catch (err) {
    console.error(`[collections] patch failed:`, err);
    return Response.json({ error: toUserError(err) }, { status: 500 });
  }
}

/**
 * POST /api/collections/{id}/members — append members to an existing collection.
 *
 * Accepts AppendMembersBodySchema: `{members | row_indices | from_scatter_selection}`
 * — distinct from CreateCollectionBodySchema (no `name`/`color`/etc; those
 * go through PATCH). The PK on `(collection_id, dataset_key, obs_index)`
 * dedupes natural duplicates; INSERT OR IGNORE … RETURNING gives the
 * exact added count for the response envelope.
 *
 * Returns CollectionMutationResult = { result: Collection, stats }. The
 * whole multi-statement flow runs in a transaction so concurrent appends
 * to the same collection serialize correctly at the connection layer.
 */
export async function handleAddMembers(collectionId: string, req: Request, store: EmbeddingStore): Promise<Response> {
  // Validate collection exists and isn't deleted.
  const existing = await selectRows(
    store,
    "SELECT collection_id FROM collections WHERE collection_id = ? AND deleted_at IS NULL",
    [collectionId],
  );
  if (existing.length === 0) {
    return Response.json({ error: "Collection not found" }, { status: 404 });
  }

  const parsed = await parseJsonBody(req, AppendMembersBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  let inTransaction = false;
  try {
    await store.conn.run("BEGIN TRANSACTION");
    inTransaction = true;

    let stats: MemberMutationStats = { total: 0, added: 0, already_member: 0 };
    if (body.members && body.members.length > 0) {
      stats = await insertMembers(store, collectionId, body.members);
    } else if (body.row_indices && body.row_indices.length > 0) {
      stats = await insertMembersByRowIndex(store, collectionId, body.row_indices);
    } else if (body.from_scatter_selection) {
      stats = await insertMembersFromScatterSelection(store, collectionId);
    }

    // Bump version + updated_at; created_count stays put (it's the size at
    // creation time). current_count grows naturally via the LEFT JOIN.
    await store.conn.run("UPDATE collections SET updated_at = ?, version = version + 1 WHERE collection_id = ?", [
      new Date().toISOString(),
      collectionId,
    ]);

    await store.conn.run("COMMIT");
    inTransaction = false;

    const out = await serializeCollection(store, collectionId);
    if (!out) return Response.json({ error: toUserError(new Error("Updated but not retrievable")) }, { status: 500 });
    return Response.json({ result: out, stats });
  } catch (err) {
    if (inTransaction) {
      try {
        await store.conn.run("ROLLBACK");
      } catch (rollbackErr) {
        console.error(`[collections] rollback failed: ${String(rollbackErr)}`);
      }
    }
    console.error(`[collections] add members failed:`, err);
    return Response.json({ error: toUserError(err) }, { status: 500 });
  }
}

// ─── Active selection (token-scoped, generic for PR3 set algebra) ──────────

/**
 * Module-level monotonic version counter for active-selection state.
 *
 * Bumped on every set/clear so the response includes a stable identity for
 * the current set composition. The frontend uses this as a TanStack Query
 * cache key for the binary `/row-indices` endpoint.
 */
let activeSelectionVersion = 0;

/**
 * Build the predicate used by Mosaic queries.
 *
 * The temp table `__active_selection` carries `(dataset_key, obs_index)`
 * rows. Predicate references the table by name — Mosaic's SQL-text cache
 * keys on the entire predicate string, and the inline token comment
 * `tok=...` (rendered as a SQL block comment) guarantees the cache busts
 * whenever the set composition changes (different token → different SQL
 * string → cache miss).
 */
function buildActiveSelectionPredicate(token: string, isMulti: boolean): string {
  const tokenComment = `/* tok=${token} */`;
  return isMulti
    ? `(_dataset, __obs_index__) IN (SELECT dataset_key, obs_index FROM __active_selection ${tokenComment})`
    : `__obs_index__ IN (SELECT obs_index FROM __active_selection ${tokenComment})`;
}

/**
 * POST /api/active-selection — set or clear the active set composition.
 *
 * Body: `{collection_ids: [id]}`. An empty array clears (equivalent to
 * DELETE /api/active-selection).
 *
 * Today only one collection is supported (single-active). PR3 extends the
 * body shape to `{ops}` for set algebra without changing this URL or the
 * response shape.
 */
export async function handleSetActiveSelection(req: Request, store: EmbeddingStore): Promise<Response> {
  const parsed = await parseJsonBody(req, SetActiveSelectionBodySchema);
  if (!parsed.ok) return parsed.response;
  const { collection_ids } = parsed.data;

  // Empty body == clear.
  if (collection_ids.length === 0) {
    return clearActiveSelection(store);
  }

  // v1 single-active: reject 2+ until PR3 ships set algebra.
  if (collection_ids.length > 1) {
    return Response.json(
      { error: "Multi-active set algebra is not yet supported. Send a single collection_id." },
      { status: 400 },
    );
  }

  const collectionId = collection_ids[0];

  const existing = await selectRows(
    store,
    "SELECT collection_id FROM collections WHERE collection_id = ? AND deleted_at IS NULL",
    [collectionId],
  );
  if (existing.length === 0) {
    return Response.json({ error: "Collection not found" }, { status: 404 });
  }

  try {
    // Stable temp-table name; CREATE OR REPLACE makes the lifecycle trivial
    // — no GC, no orphaned tables on switch, no race with /row-indices.
    await store.conn.run(
      `CREATE OR REPLACE TEMP TABLE __active_selection AS
       SELECT dataset_key, obs_index, __row_index__
       FROM collection_members m
       INNER JOIN obs_base b ON b.__obs_index__ = m.obs_index
       WHERE m.collection_id = ?`,
      [collectionId],
    );

    const counts = await selectRows(store, "SELECT COUNT(*) AS n FROM __active_selection");
    const resolvedCount = scalarNumber(counts[0]?.n ?? 0);

    activeSelectionVersion++;
    const token = `${activeSelectionVersion}_${Date.now().toString(36)}`;
    const isMulti = await store.hasDatasetColumn();
    const predicate = buildActiveSelectionPredicate(token, isMulti);

    return Response.json({
      token,
      predicate,
      resolved_count: resolvedCount,
      version: activeSelectionVersion,
    });
  } catch (err) {
    console.error(`[active-selection] set failed:`, err);
    return Response.json({ error: toUserError(err) }, { status: 500 });
  }
}

/**
 * GET /api/active-selection/row-indices — binary uint32 row indices of the
 * current active set, in `obs_base` row order.
 *
 * Layout: raw little-endian uint32 (4 bytes per row, no header). Frontend
 * reads via `new Uint32Array(buffer)` for direct GPU upload into the dim
 * mask. JSON would 3x the wire size for no benefit.
 */
export async function handleGetActiveSelectionRowIndices(store: EmbeddingStore): Promise<Response> {
  try {
    const exists = await selectRows(
      store,
      "SELECT 1 FROM information_schema.tables WHERE table_name = '__active_selection'",
    );
    if (exists.length === 0) {
      // No active selection — empty body is a valid response.
      return new Response(new Uint8Array(0), {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }

    const rows = await selectRows(store, "SELECT __row_index__ AS r FROM __active_selection ORDER BY __row_index__");
    const buf = new Uint32Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      buf[i] = scalarNumber(rows[i].r);
    }

    return new Response(new Uint8Array(buf.buffer) as unknown as BodyInit, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  } catch (err) {
    console.error(`[active-selection] read row-indices failed:`, err);
    return Response.json({ error: toUserError(err) }, { status: 500 });
  }
}

/** DELETE /api/active-selection — drop the temp table; bump version. */
export function handleClearActiveSelection(store: EmbeddingStore): Promise<Response> {
  return clearActiveSelection(store);
}

async function clearActiveSelection(store: EmbeddingStore): Promise<Response> {
  try {
    await store.conn.run("DROP TABLE IF EXISTS __active_selection");
    activeSelectionVersion++;
    return Response.json({ ok: true, version: activeSelectionVersion });
  } catch (err) {
    console.error(`[active-selection] clear failed:`, err);
    return Response.json({ error: toUserError(err) }, { status: 500 });
  }
}

/** DELETE /api/collections/{id} — soft delete (sets deleted_at). */
export async function handleDeleteCollection(collectionId: string, store: EmbeddingStore): Promise<Response> {
  try {
    const existing = await selectRows(
      store,
      "SELECT collection_id FROM collections WHERE collection_id = ? AND deleted_at IS NULL",
      [collectionId],
    );
    if (existing.length === 0) {
      return Response.json({ error: "Collection not found" }, { status: 404 });
    }

    await store.conn.run(
      "UPDATE collections SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE collection_id = ?",
      [new Date().toISOString(), new Date().toISOString(), collectionId],
    );
    return Response.json({ deleted: collectionId });
  } catch (err) {
    console.error(`[collections] delete failed:`, err);
    return Response.json({ error: toUserError(err) }, { status: 500 });
  }
}

// ─── Export ─────────────────────────────────────────────────────────────────

/**
 * Sanitize the collection name into a filename-safe slug. Lowercases, swaps
 * non-alphanumerics for underscores, collapses runs, trims, and caps at 40
 * chars. Falls back to `collection-<id-prefix>` when the slug would be empty
 * (e.g. all-symbol names).
 */
function exportSlug(name: string, idPrefix: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : `collection-${idPrefix}`;
}

/**
 * POST /api/collections/{id}/export
 *
 * Body: {
 *   format: "csv" | "parquet",
 *   output_dir?: string,    // absolute; defaults to exportDir()
 *   filename?: string,      // base name without extension; defaults to slug(name)
 *   overwrite?: boolean,    // confirm overwrite of existing file
 * }
 * Response (200): { output_path, n_obs, size_bytes, format }
 * Response (409): { error: "File exists", existing_path, existing_size_bytes }
 *
 * Server-only filesystem write — analyst is on the same host as the dev
 * server. Members-only shape: rows = |collection|, cols = obs_base columns.
 * Caller joins back to AnnData by `obs_name` (single dataset) or
 * `(_dataset, obs_name)` (multi-dataset).
 *
 * Path safety: resolved output path must be absolute and not under known
 * system directories. Single quotes in the path are escaped before
 * embedding in DuckDB COPY TO SQL.
 */

const SYSTEM_DIR_DENYLIST = ["/etc", "/sys", "/proc", "/dev", "/private/etc", "/private/dev"];

function isUnderSystemDir(absolutePath: string): boolean {
  return SYSTEM_DIR_DENYLIST.some((root) => absolutePath === root || absolutePath.startsWith(`${root}/`));
}

function sanitizeFilename(raw: string): string {
  // Strip path separators, control chars, shell metachars; collapse runs.
  // Control chars (0x00-0x1F, 0x7F) get scrubbed via charCodeAt — keeps
  // the visible regex literals free of inline control bytes (oxlint friendly).
  const noControl = Array.from(raw, (c) => {
    const code = c.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? "_" : c;
  }).join("");
  return noControl
    .replace(/[/\\]/g, "_")
    .replace(/[ -"`$<>|;&*?]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 200);
}

export async function handleExportCollection(
  collectionId: string,
  req: Request,
  store: EmbeddingStore,
): Promise<Response> {
  let body: { format?: unknown; output_dir?: unknown; filename?: unknown; overwrite?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const formatRaw = typeof body.format === "string" ? body.format.toLowerCase() : "";
  if (formatRaw !== "csv" && formatRaw !== "parquet") {
    return Response.json({ error: "format must be 'csv' or 'parquet'" }, { status: 400 });
  }
  const format = formatRaw;
  const overwrite = body.overwrite === true;

  const existing = await selectRows(
    store,
    "SELECT name FROM collections WHERE collection_id = ? AND deleted_at IS NULL",
    [collectionId],
  );
  if (existing.length === 0) {
    return Response.json({ error: "Collection not found" }, { status: 404 });
  }
  const collectionName = scalarString(existing[0].name) ?? "collection";

  const { exportDir } = await import("./export.ts");
  const { mkdir, stat } = await import("node:fs/promises");
  const { resolve, isAbsolute, join } = await import("node:path");

  // ── Resolve + validate output directory ────────────────────────
  const rawDir =
    typeof body.output_dir === "string" && body.output_dir.trim().length > 0 ? body.output_dir.trim() : exportDir();
  if (!isAbsolute(rawDir)) {
    return Response.json({ error: "output_dir must be an absolute path" }, { status: 400 });
  }
  const resolvedDir = resolve(rawDir);
  if (isUnderSystemDir(resolvedDir)) {
    return Response.json({ error: "output_dir is under a protected system directory" }, { status: 400 });
  }
  try {
    await mkdir(resolvedDir, { recursive: true });
    const dirStat = await stat(resolvedDir);
    if (!dirStat.isDirectory()) {
      return Response.json({ error: "output_dir exists but is not a directory" }, { status: 400 });
    }
  } catch (err) {
    return Response.json(
      { error: `Cannot prepare output_dir: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 400 },
    );
  }

  // ── Resolve filename ───────────────────────────────────────────
  const ext = format === "csv" ? "csv" : "parquet";
  const rawFilename =
    typeof body.filename === "string" && body.filename.trim().length > 0
      ? body.filename.trim().replace(/\.(csv|parquet)$/i, "")
      : exportSlug(collectionName, collectionId.slice(0, 8));
  const safeFilename = sanitizeFilename(rawFilename);
  if (safeFilename.length === 0) {
    return Response.json({ error: "filename is empty after sanitization" }, { status: 400 });
  }
  const outputPath = join(resolvedDir, `${safeFilename}.${ext}`);

  // ── Existence check (Bun-native, faster than fs.existsSync) ─────
  if (!overwrite && (await Bun.file(outputPath).exists())) {
    let existingSize = 0;
    try {
      existingSize = (await stat(outputPath)).size;
    } catch {
      /* ignore */
    }
    return Response.json(
      { error: "File exists", existing_path: outputPath, existing_size_bytes: existingSize },
      { status: 409 },
    );
  }

  // ── COPY TO ────────────────────────────────────────────────────
  const escapedPath = outputPath.replaceAll("'", "''");
  const copyOptions = format === "csv" ? "(FORMAT CSV, HEADER, DELIMITER ',')" : "(FORMAT PARQUET)";

  try {
    await store.execute(
      `COPY (
         SELECT d.*
         FROM dataset d
         WHERE d.__obs_index__ IN (
           SELECT obs_index FROM collection_members WHERE collection_id = '${collectionId.replaceAll("'", "''")}'
         )
       ) TO '${escapedPath}' ${copyOptions}`,
    );
  } catch (err) {
    console.error("[collections] export COPY failed:", err);
    return Response.json({ error: toUserError(err) }, { status: 500 });
  }

  const countRows = await selectRows(store, `SELECT COUNT(*) AS n FROM collection_members WHERE collection_id = ?`, [
    collectionId,
  ]);
  const nObs = scalarNumber(countRows[0]?.n ?? 0);
  const fileStat = await stat(outputPath);

  return Response.json({
    output_path: outputPath,
    n_obs: nObs,
    size_bytes: fileStat.size,
    format,
  });
}
