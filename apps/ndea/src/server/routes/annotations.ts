/**
 * Annotation field endpoints: user-defined obs columns edited from the Table.
 *
 * Fields live in `ann_{safe_name}` tables aligned to obs_base by
 * __row_index__. They join into the `dataset` VIEW via the same LEFT JOIN
 * pattern as var columns. Every mutation rewrites the combined parquet
 * sidecar (when a path is set) before responding.
 *
 * Routes:
 *   GET    /api/annotations/columns         : list fields
 *   POST   /api/annotations/columns         : create a field
 *   PATCH  /api/annotations/columns/:name   : rename and/or convert a field
 *   DELETE /api/annotations/columns/:name   : drop a field
 *   POST   /api/annotations/values          : write cells by row index
 *   POST   /api/annotations/commit          : write fields into source `.obs`
 */

import {
  type AnnotationDtype,
  AnnotationColumnBodySchema,
  AnnotationColumnPatchBodySchema,
  CommitAnnotationsBodySchema,
  WriteAnnotationValuesBodySchema,
  parseJsonBody,
} from "../protocol.ts";
import { quoteIdent } from "../store.ts";
import type { ServerSession } from "../state.ts";
import { commitObsColumns, type ObsColumnInput } from "@ndea/zarr";

// Names claimed by an in-flight create or rename: closes a TOCTOU window where
// two concurrent requests for the same not-yet-existing name both pass the check.
const _claimed = new Set<string>();

/**
 * 409 unless the name is new to the dataset: the VIEW would otherwise
 * auto-rename the duplicate (cell_type → cell_type_1), landing the field under
 * a name the frontend never queries. `columns()` already lists every field.
 */
function nameConflict(state: ServerSession, name: string): Response | null {
  if (!_claimed.has(name) && !state.store.hasAnnotationColumn(name) && !state.store.columns().has(name)) return null;
  return Response.json({ error: "A field or column with this name already exists" }, { status: 409 });
}

const NOT_FOUND = () => Response.json({ error: "Field not found" }, { status: 404 });
const failed = (err: unknown) =>
  Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });

/** Persist fields to the parquet sidecar, when this session has one. */
async function saveSidecar(state: ServerSession): Promise<void> {
  if (state.annotationsSidecarPath) await state.store.saveAnnotationsSidecar(state.annotationsSidecarPath);
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/** GET /api/annotations/columns: `[{ name, dtype }]`. */
export function handleListAnnotationColumns(state: ServerSession): Response {
  const columns = [...state.store.annotationColumns.values()].map((e) => ({ name: e.colName, dtype: e.dtype }));
  return Response.json({ columns });
}

/** POST /api/annotations/columns */
export async function handleCreateAnnotationColumn(req: Request, state: ServerSession): Promise<Response> {
  const parsed = await parseJsonBody(req, AnnotationColumnBodySchema);
  if (!parsed.ok) return parsed.response;
  const { name, dtype } = parsed.data;
  const conflict = nameConflict(state, name);
  if (conflict) return conflict;

  _claimed.add(name);
  try {
    // /data/metadata.json lists fields from the store, so the client's
    // refreshMetadata() picks this one up.
    await state.store.registerAnnotationColumn(name, dtype);
    await saveSidecar(state);
    return Response.json({ column: name }, { status: 201 });
  } catch (err) {
    return failed(err);
  } finally {
    _claimed.delete(name);
  }
}

/** PATCH /api/annotations/columns/:name: rename and/or convert; `{ column, dtype }`. */
export async function handlePatchAnnotationColumn(
  colName: string,
  req: Request,
  state: ServerSession,
): Promise<Response> {
  const parsed = await parseJsonBody(req, AnnotationColumnPatchBodySchema);
  if (!parsed.ok) return parsed.response;
  if (!state.store.hasAnnotationColumn(colName)) return NOT_FOUND();
  const to = parsed.data.name ?? colName;
  const renaming = to !== colName;
  const conflict = renaming ? nameConflict(state, to) : null;
  if (conflict) return conflict;

  if (renaming) _claimed.add(to);
  try {
    if (renaming) await state.store.renameAnnotationColumn(colName, to);
    if (parsed.data.dtype) await state.store.setAnnotationDtype(to, parsed.data.dtype);
    await saveSidecar(state);
    return Response.json({ column: to, dtype: state.store.annotationColumns.get(to)?.dtype });
  } catch (err) {
    return failed(err);
  } finally {
    if (renaming) _claimed.delete(to);
  }
}

/** DELETE /api/annotations/columns/:name */
export async function handleDeleteAnnotationColumn(colName: string, state: ServerSession): Promise<Response> {
  if (!state.store.hasAnnotationColumn(colName)) return NOT_FOUND();
  try {
    await state.store.dropAnnotationColumn(colName);
    await saveSidecar(state);
    return new Response(null, { status: 204 });
  } catch (err) {
    return failed(err);
  }
}

/** POST /api/annotations/values: `{ ok: true, n }`, n = rows written (unknown row indices are skipped). */
export async function handleWriteAnnotationValues(req: Request, state: ServerSession): Promise<Response> {
  const parsed = await parseJsonBody(req, WriteAnnotationValuesBodySchema);
  if (!parsed.ok) return parsed.response;
  const { column, rows } = parsed.data;
  if (!state.store.hasAnnotationColumn(column)) return NOT_FOUND();
  try {
    const n = await state.store.writeAnnotationValues(column, rows);
    await saveSidecar(state);
    return Response.json({ ok: true, n });
  } catch (err) {
    return failed(err);
  }
}

/**
 * POST /api/annotations/commit[?dryRun=1]: "Commit to .obs".
 *
 * Writes annotation fields into each source AnnData `.obs` on disk, grouped by
 * `dataset_key` and aligned by `obs_name`. `dryRun` returns the report without
 * writing. Omitting `columns` commits all of them.
 */
export async function handleCommitAnnotations(req: Request, state: ServerSession, dryRun: boolean): Promise<Response> {
  const parsed = await parseJsonBody(req, CommitAnnotationsBodySchema);
  if (!parsed.ok) return parsed.response;
  const names = (parsed.data.columns ?? [...state.store.annotationColumns.keys()]).filter((n) =>
    state.store.hasAnnotationColumn(n),
  );
  if (names.length === 0) return Response.json({ error: "No annotation fields to commit" }, { status: 400 });

  // Group the labeled values by dataset_key → column → Map<obs_name, value>.
  const perDataset = new Map<string, Map<string, Map<string, string | null>>>();
  const colDtype = new Map<string, AnnotationDtype>();
  for (const name of names) {
    const entry = state.store.annotationColumns.get(name);
    if (!entry) continue;
    colDtype.set(name, entry.dtype);
    const rows = (await state.store.queryJson(
      `SELECT dataset_key, obs_name, ${quoteIdent(name)} AS value FROM ${entry.table} WHERE ${quoteIdent(name)} IS NOT NULL`,
    )) as { dataset_key: string | null; obs_name: string; value: string | null }[];
    for (const r of rows) {
      const dk = r.dataset_key ?? "";
      let cols = perDataset.get(dk);
      if (!cols) perDataset.set(dk, (cols = new Map()));
      let vals = cols.get(name);
      if (!vals) cols.set(name, (vals = new Map()));
      vals.set(r.obs_name, r.value);
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
    const obsCols: ObsColumnInput[] = [...cols.entries()].map(([name, values]) => ({
      name,
      kind: colDtype.get(name) === "text" ? "string" : "categorical",
      values,
    }));
    try {
      const report = await commitObsColumns(cfg.path, obsCols, { dryRun });
      reports.push({ datasetKey: dk, path: cfg.path, ...report });
    } catch (err) {
      reports.push({ datasetKey: dk, path: cfg.path, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return Response.json({ dryRun, datasets: reports });
}
