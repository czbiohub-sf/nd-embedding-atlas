/**
 * User annotation endpoints — write new obs columns with user-defined values.
 *
 * Annotation columns live in `ann_{safe_name}` tables aligned to obs_base by
 * __row_index__. They join into the `dataset` VIEW via the same LEFT JOIN
 * pattern as var columns. A combined parquet sidecar provides persistence
 * across server restarts (auto-written 2s after any mutation).
 *
 * Routes:
 *   GET    /api/annotations/columns          — list annotation column names
 *   POST   /api/annotations/columns          — create a column
 *   DELETE /api/annotations/columns/:name    — drop a column
 *   POST   /api/annotations/values           — write values (rows or collection)
 *   POST   /api/annotations/save             — explicit sidecar checkpoint
 *   GET    /api/annotations/export           — download combined parquet/csv
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type AnnotationDtype,
  AnnotationColumnBodySchema,
  AnnotationExportBodySchema,
  CommitAnnotationsBodySchema,
  WriteAnnotationValuesBodySchema,
  parseJsonBody,
} from "../protocol.ts";
import { exportDir, sanitiseFilename } from "../export-util.ts";
import { quoteIdent } from "../store.ts";
import type { ServerSession } from "../state.ts";
import { commitObsColumns, type ObsColumnInput } from "@ndea/zarr";

// ─── Debounced auto-save ─────────────────────────────────────────────────────
//
// ponytail: module-global timer — fine for the single-process, single-session
// server (verified: the multi-session concern was refuted in review). If
// the server ever hosts concurrent sessions, key this by session id.

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _savePending = false;

function scheduleSave(state: ServerSession): void {
  if (!state.annotationsSidecarPath) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _savePending = true;
  const path = state.annotationsSidecarPath;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    _savePending = false;
    state.store
      .saveAnnotationsSidecar(path)
      .catch((err: unknown) => console.error("[annotations] auto-save failed:", err));
  }, 2000);
}

/**
 * Flush any pending debounced save synchronously. Call from the shutdown
 * handler — for in-memory sessions the sidecar is the ONLY persistence, so a
 * pending save dropped on SIGINT loses up to 2s of edits.
 */
export async function flushAnnotationSaves(state: ServerSession): Promise<void> {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (!_savePending || !state.annotationsSidecarPath) return;
  _savePending = false;
  try {
    await state.store.saveAnnotationsSidecar(state.annotationsSidecarPath);
  } catch (err) {
    console.error("[annotations] shutdown flush failed:", err);
  }
}

// In-flight column creations — closes a TOCTOU window where two concurrent
// POSTs for the same not-yet-existing name both pass the existence check.
const _creating = new Set<string>();

// ─── Handlers ────────────────────────────────────────────────────────────────

/** GET /api/annotations/columns — `[{ name, dtype }]`. */
export function handleListAnnotationColumns(state: ServerSession): Response {
  const columns = [...state.store.annotationColumns.values()].map((e) => ({ name: e.colName, dtype: e.dtype }));
  return Response.json({ columns });
}

/** POST /api/annotations/columns */
export async function handleCreateAnnotationColumn(req: Request, state: ServerSession): Promise<Response> {
  const parsed = await parseJsonBody(req, AnnotationColumnBodySchema);
  if (!parsed.ok) return parsed.response;
  const { name, dtype } = parsed.data;

  if (state.store.hasAnnotationColumn(name) || _creating.has(name)) {
    return Response.json({ error: "Column already exists" }, { status: 409 });
  }

  // Reject names that collide with an existing dataset column (obs_base, an
  // embedding, or a var column). _rebuildView would otherwise auto-rename the
  // duplicate (cell_type → cell_type_1), landing the annotation under a name
  // the frontend never queries.
  if (await state.store.datasetColumnExists(name)) {
    return Response.json({ error: "A column with this name already exists in the dataset" }, { status: 409 });
  }

  _creating.add(name);
  try {
    await state.store.registerAnnotationColumn(name, dtype);
    // Surface the column in /data/metadata.json (obs_columns is the same array
    // the table + color picker read; refreshMetadata() on the client picks it up).
    if (!state.obsColumns.includes(name)) state.obsColumns.push(name);
    scheduleSave(state);
    return Response.json({ column: name }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  } finally {
    _creating.delete(name);
  }
}

/** DELETE /api/annotations/columns/:name */
export async function handleDeleteAnnotationColumn(colName: string, state: ServerSession): Promise<Response> {
  if (!state.store.hasAnnotationColumn(colName)) {
    return Response.json({ error: "Column not found" }, { status: 404 });
  }
  try {
    await state.store.dropAnnotationColumn(colName);
    const i = state.obsColumns.indexOf(colName);
    if (i !== -1) state.obsColumns.splice(i, 1);
    scheduleSave(state);
    return new Response(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/annotations/values
 *
 * Four write paths (see WriteAnnotationValuesBodySchema):
 *   rows                 — explicit { rowIndex, datasetKey, obsName, value }[]
 *   collectionId         — promote a saved collection (label = collection name)
 *   fromScatterSelection — stamp `label` onto the staged __scatter_selection
 *   predicate            — stamp `label` onto every obs matching a SQL WHERE
 *                          (the node-graph batch door); returns the matched count
 */
export async function handleWriteAnnotationValues(req: Request, state: ServerSession): Promise<Response> {
  const parsed = await parseJsonBody(req, WriteAnnotationValuesBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (!state.store.hasAnnotationColumn(body.column)) {
    return Response.json({ error: "Column not found — create it first" }, { status: 404 });
  }

  try {
    let applied: number | null = null;
    if (body.fromScatterSelection) {
      await state.store.writeAnnotationFromScatterSelection(body.column, body.label ?? null);
    } else if (body.predicate != null) {
      applied = await state.store.writeAnnotationFromPredicate(body.column, body.label ?? null, body.predicate);
    } else if (body.rows != null && body.rows.length > 0) {
      await state.store.writeAnnotationValues(body.column, body.rows);
    } else if (body.collectionId != null) {
      await _writeFromCollection(body.column, body.collectionId, body.label, state);
    } else {
      return Response.json(
        { error: "Provide one of 'rows', 'collectionId', 'predicate', or 'fromScatterSelection'" },
        { status: 400 },
      );
    }

    scheduleSave(state);
    return Response.json(applied == null ? { ok: true } : { ok: true, n: applied });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/** POST /api/annotations/save — explicit sidecar checkpoint. */
export async function handleSaveAnnotations(state: ServerSession): Promise<Response> {
  if (!state.annotationsSidecarPath) {
    return Response.json({ error: "No writable sidecar path configured" }, { status: 503 });
  }
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  try {
    await state.store.saveAnnotationsSidecar(state.annotationsSidecarPath);
    return Response.json({ path: state.annotationsSidecarPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/annotations/export — "Save file".
 *
 * Writes a wide table — `obs_name` (+ `_dataset` when multi-dataset) + the chosen
 * annotation columns — for the row scope (all · active filter · a collection) to
 * the server export-dir as parquet/csv.
 */
export async function handleExportAnnotations(req: Request, state: ServerSession): Promise<Response> {
  const parsed = await parseJsonBody(req, AnnotationExportBodySchema);
  if (!parsed.ok) return parsed.response;
  const { columns, scope, format, filename } = parsed.data;

  for (const c of columns) {
    if (!state.store.hasAnnotationColumn(c)) return Response.json({ error: `Unknown column: ${c}` }, { status: 404 });
  }

  // Row scope → WHERE. `filter` interpolates the client's Mosaic predicate (same
  // trust model as /api/export — single-user local tool).
  let where = "";
  if (scope.kind === "filter") where = `WHERE ${scope.predicate}`;
  else if (scope.kind === "collection")
    where = `WHERE __obs_index__ IN (SELECT obs_index FROM collection_members WHERE collection_id = '${scope.collectionId.replace(/'/g, "''")}')`;

  const idCols = (await state.store.hasDatasetColumn()) ? "obs_name, _dataset" : "obs_name";
  const valCols = columns.map((c) => `CAST(${quoteIdent(c)} AS TEXT) AS ${quoteIdent(c)}`).join(", ");
  const dir = exportDir();
  const file = join(dir, sanitiseFilename(filename ?? "annotations", format));
  const escaped = file.replace(/'/g, "''");

  try {
    await mkdir(dir, { recursive: true });
    await state.store.execute(
      `COPY (SELECT ${idCols}, ${valCols} FROM dataset ${where}) TO '${escaped}' (FORMAT ${format})`,
    );
    const cnt = await state.store.queryJson(`SELECT COUNT(*) AS n FROM dataset ${where}`);
    return Response.json({ output_path: file, n_obs: Number(cnt[0].n), format });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/annotations/commit[?dryRun=1] — "Commit to .obs".
 *
 * Writes annotation columns into each source AnnData `.obs` on disk, grouped by
 * `dataset_key` and aligned by `obs_name`. `dryRun` returns the report without
 * writing. Omitting `columns` commits all of them.
 */
export async function handleCommitAnnotations(req: Request, state: ServerSession, dryRun: boolean): Promise<Response> {
  const parsed = await parseJsonBody(req, CommitAnnotationsBodySchema);
  if (!parsed.ok) return parsed.response;
  const names = (parsed.data.columns ?? [...state.store.annotationColumns.keys()]).filter((n) =>
    state.store.hasAnnotationColumn(n),
  );
  if (names.length === 0) return Response.json({ error: "No annotation columns to commit" }, { status: 400 });

  // Group the labeled values by dataset_key → column → Map<obs_name, value>.
  const perDataset = new Map<string, Map<string, Map<string, string | null>>>();
  const colDtype = new Map<string, AnnotationDtype>();
  for (const name of names) {
    const entry = state.store.annotationColumns.get(name);
    if (!entry) continue;
    colDtype.set(name, entry.dtype);
    const rows = (await state.store.queryJson(
      `SELECT dataset_key, obs_name, CAST(${quoteIdent(name)} AS TEXT) AS value FROM ${entry.table} WHERE ${quoteIdent(name)} IS NOT NULL`,
    )) as { dataset_key: string | null; obs_name: string | number; value: string | null }[];
    for (const r of rows) {
      const dk = r.dataset_key ?? "";
      let cols = perDataset.get(dk);
      if (!cols) perDataset.set(dk, (cols = new Map()));
      let vals = cols.get(name);
      if (!vals) cols.set(name, (vals = new Map()));
      vals.set(`${r.obs_name}`, r.value);
    }
  }

  // Resolve each dataset_key to its source zarr root and commit.
  const single = state.datasets.size === 1 ? [...state.datasets.values()][0] : null;
  const reports: unknown[] = [];
  for (const [dk, cols] of perDataset) {
    const cfg = single ?? state.datasets.get(dk);
    if (!cfg) {
      reports.push({ datasetKey: dk, error: "no source dataset for this key" });
      continue;
    }
    if (/^https?:\/\//.test(cfg.path)) {
      reports.push({ datasetKey: dk, path: cfg.path, error: "remote stores can't be written back yet" });
      continue;
    }
    const obsCols: ObsColumnInput[] = [...cols.entries()].map(([name, values]) => {
      const dtype = colDtype.get(name) ?? "categorical";
      if (dtype === "integer" || dtype === "float") {
        const nums = new Map<string, number | null>();
        for (const [k, v] of values) nums.set(k, v == null ? null : Number(v));
        return { name, kind: dtype === "float" ? "float" : "int", values: nums };
      }
      return { name, kind: dtype === "string" ? "string" : "categorical", values };
    });
    try {
      const report = await commitObsColumns(cfg.path, obsCols, { dryRun });
      reports.push({ datasetKey: dk, path: cfg.path, ...report });
    } catch (err) {
      reports.push({ datasetKey: dk, path: cfg.path, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return Response.json({ dryRun, datasets: reports });
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function _writeFromCollection(
  colName: string,
  collectionId: string,
  labelOverride: string | undefined,
  state: ServerSession,
): Promise<void> {
  const entry = state.store.annotationColumns.get(colName);
  if (!entry) throw new Error(`Unknown annotation column: ${colName}`);

  let label = labelOverride;
  if (!label) {
    const rows = await state.store.queryJson(
      `SELECT name FROM collections WHERE collection_id = '${collectionId.replace(/'/g, "''")}'`,
    );
    if (rows.length === 0) throw new Error(`Collection not found: ${collectionId}`);
    label = String(rows[0].name);
  }

  const escapedCol = colName.replace(/'/g, "''");
  const escapedLabel = label.replace(/'/g, "''");
  const escapedId = collectionId.replace(/'/g, "''");

  // obs_index in collection_members aligns directly to __row_index__ in obs_base.
  await state.store.execute(
    `INSERT OR REPLACE INTO ${entry.table} (__row_index__, dataset_key, obs_name, "${escapedCol}") ` +
      `SELECT cm.obs_index, cm.dataset_key, cm.obs_name, '${escapedLabel}' ` +
      `FROM collection_members cm ` +
      `WHERE cm.collection_id = '${escapedId}'`,
  );
}
