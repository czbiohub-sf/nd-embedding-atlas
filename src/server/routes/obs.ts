/**
 * Observation lookup endpoints.
 *
 * POST /api/obs/batch           — Batch spatial metadata for many observations
 * GET  /api/obs/{row_index}     — Spatial info for a single observation
 * GET  /api/obs/{row_index}/detail — All obs columns for a single observation
 * GET  /api/health              — Health check
 */

import { parseBbox, type ViewerState } from "../state.ts";

/** Stringify a DuckDB scalar without risking [object Object]. */
function scalarToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Handle POST /api/obs/batch with body `{ row_indices: number[] }`.
 *
 * Returns spatial metadata (x, y, fov, t) per observation. POST not GET so
 * a 5k-row lasso selection doesn't blow past Bun's request header size cap.
 */
export async function handleObsBatch(req: Request, state: ViewerState): Promise<Response> {
  const sp = state.spatial;

  if (!sp?.x || !sp?.y) {
    return Response.json({});
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const list = (body as { row_indices?: unknown }).row_indices;
  if (!Array.isArray(list)) {
    return Response.json({ error: "row_indices must be an array of integers" }, { status: 422 });
  }

  const rowIndices: number[] = [];
  for (const v of list) {
    if (!Number.isInteger(v)) {
      return Response.json({ error: "row_indices must be integers" }, { status: 422 });
    }
    rowIndices.push(v as number);
  }

  if (rowIndices.length === 0) {
    return Response.json({});
  }

  try {
    const placeholders = rowIndices.join(", ");
    const isMulti = state.datasets.size > 1;
    const selectCols = [`"${sp.x}"`, `"${sp.y}"`];
    if (sp.fov) selectCols.push(`"${sp.fov}"`);
    if (sp.t) selectCols.push(`"${sp.t}"`);
    if (isMulti) selectCols.push("_dataset");

    const rows = await state.store.queryJson(
      `SELECT __row_index__, ${selectCols.join(", ")} FROM obs_base WHERE __row_index__ IN (${placeholders})`,
    );

    const result: Record<string, { x: number; y: number; fov?: string; t?: number; dataset?: string }> = {};
    for (const row of rows) {
      const entry: { x: number; y: number; fov?: string; t?: number; dataset?: string } = {
        x: Number(row[sp.x]),
        y: Number(row[sp.y]),
      };
      if (sp.fov && row[sp.fov] != null) entry.fov = scalarToString(row[sp.fov]);
      if (sp.t && row[sp.t] != null) entry.t = Number(row[sp.t]);
      if (isMulti && row._dataset != null) entry.dataset = scalarToString(row._dataset);
      result[String(row.__row_index__)] = entry;
    }
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * Handle GET /api/obs/{row_index}
 *
 * Returns spatial coordinates for a single observation.
 */
export async function handleObsInfo(rowIndex: number, state: ViewerState): Promise<Response> {
  const sp = state.spatial;
  const selectCols: string[] = [];

  if (state.datasets.size > 1) {
    selectCols.push("_dataset");
  }
  if (sp?.fov) selectCols.push(sp.fov);
  if (sp?.t) selectCols.push(sp.t);
  if (sp?.bbox) selectCols.push(sp.bbox);
  if (sp?.x) selectCols.push(sp.x);
  if (sp?.y) selectCols.push(sp.y);

  if (selectCols.length === 0) {
    return Response.json({ error: "No spatial columns configured" }, { status: 404 });
  }

  try {
    const quoted = selectCols.map((c) => `"${c}"`).join(", ");
    const rows = await state.store.queryJson(`SELECT ${quoted} FROM obs_base WHERE __row_index__ = ${rowIndex}`);

    if (rows.length === 0) {
      return Response.json({ error: "Observation not found" }, { status: 404 });
    }

    const row = rows[0];
    const response: Record<string, unknown> = {};

    if (sp?.fov) {
      response.fov_name = String(row[sp.fov]);
    }

    response.t = sp?.t && row[sp.t] != null ? Number(row[sp.t]) : 0;

    if (sp?.bbox && row[sp.bbox] != null) {
      const bbox = parseBbox(String(row[sp.bbox]));
      if (bbox) {
        response.bbox = {
          y_min: bbox.yMin,
          x_min: bbox.xMin,
          y_max: bbox.yMax,
          x_max: bbox.xMax,
        };
        response.x = (bbox.xMin + bbox.xMax) / 2;
        response.y = (bbox.yMin + bbox.yMax) / 2;
      }
    }

    if (sp?.x && row[sp.x] != null) {
      response.x = Number(row[sp.x]);
      response.y = Number(row[sp.y!]);
    }

    // Multi-dataset: include store_index
    if (state.datasets.size > 1 && row._dataset != null) {
      const datasetKeys = Array.from(state.datasets.keys());
      const idx = datasetKeys.indexOf(scalarToString(row._dataset));
      if (idx >= 0) {
        response.store_index = idx;
      }
    }

    return Response.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * Handle GET /api/obs/{row_index}/detail
 *
 * Returns all visible obs columns for a single observation.
 */
export async function handleObsDetail(rowIndex: number, state: ViewerState): Promise<Response> {
  try {
    // Get column names from obs_base, excluding hidden columns
    const descRows = await state.store.queryJson("SELECT column_name FROM (DESCRIBE obs_base)");
    const allCols = descRows.map((r) => String(r.column_name));
    // Filter out hidden columns (we don't track hidden in TS ViewerState yet,
    // but obs_base has all columns; the VIEW filters them)
    const cols = allCols;
    const quoted = cols.map((c) => `"${c}"`).join(", ");

    const rows = await state.store.queryJson(`SELECT ${quoted} FROM obs_base WHERE __row_index__ = ${rowIndex}`);

    if (rows.length === 0) {
      return Response.json({ error: "Observation not found" }, { status: 404 });
    }

    // Stringify all values for display
    const result: Record<string, string | null> = {};
    const row = rows[0];
    for (const col of cols) {
      result[col] = row[col] != null ? scalarToString(row[col]) : null;
    }

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * Handle GET /api/health
 */
export function handleHealth(state: ViewerState): Response {
  return Response.json({
    status: "ok",
    n_obs: state.store.nObs,
    loaded_embeddings: Array.from(state.obsmLoaders.keys()),
    available_embeddings: state.availableObsmKeys,
  });
}
