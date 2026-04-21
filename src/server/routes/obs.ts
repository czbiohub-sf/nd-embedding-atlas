/**
 * Observation lookup endpoints.
 *
 * GET /api/obs/batch           — Batch x/y centroids for multiple observations
 * GET /api/obs/{row_index}     — Spatial info for a single observation
 * GET /api/obs/{row_index}/detail — All obs columns for a single observation
 * GET /api/health              — Health check
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
 * Handle GET /api/obs/batch?ids=1,2,3
 *
 * Returns x/y centroids for multiple observations in one query.
 */
export async function handleObsBatch(url: URL, state: ViewerState): Promise<Response> {
  const ids = url.searchParams.get("ids");
  const sp = state.spatial;

  if (!sp?.x || !sp?.y) {
    return Response.json({});
  }

  if (!ids) {
    return Response.json({ error: "ids must be comma-separated integers" }, { status: 422 });
  }

  const rowIndices: number[] = [];
  for (const s of ids.split(",")) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n)) {
      return Response.json({ error: "ids must be comma-separated integers" }, { status: 422 });
    }
    rowIndices.push(n);
  }

  if (rowIndices.length === 0) {
    return Response.json({});
  }

  try {
    const placeholders = rowIndices.join(", ");
    const rows = await state.store.queryJson(
      `SELECT __row_index__, "${sp.x}", "${sp.y}" FROM obs_base WHERE __row_index__ IN (${placeholders})`,
    );

    const result: Record<string, { x: number; y: number }> = {};
    for (const row of rows) {
      result[String(row.__row_index__)] = {
        x: Number(row[sp.x]),
        y: Number(row[sp.y]),
      };
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
