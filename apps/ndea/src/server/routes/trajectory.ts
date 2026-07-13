/**
 * GET /api/trajectory — server-side join of trajectory metadata + obsm
 * positions for a single (track_id, fov_name) pair.
 *
 * Why this exists (replaces client-side Mosaic SQL path):
 *   The frontend previously built a SQL like
 *     SELECT __row_index__, phate_0 AS emb_x, phate_1 AS emb_y, ...
 *     FROM dataset WHERE track_id = ? AND fov_name = ?
 *   but obsm columns (phate_0, phate_1, pca_0, ...) are NOT materialized
 *   into the `dataset` VIEW. They're served by `/api/scatter-positions`
 *   through `ObsmSliceLoader` instead. That made the trajectory query fail
 *   with `Binder Error: Referenced column "phate_0" not found in FROM
 *   clause` as an unhandled promise rejection.
 *
 * Design:
 *   1. Small SQL query against the `dataset` VIEW for trajectory metadata
 *      (row index, t, spatial x/y, dataset, optional category).
 *   2. Two obsm column reads via `ObsmSliceLoader` — the same path
 *      `/api/scatter-positions` uses for the main scatter.
 *   3. Merge in JS by __row_index__ and emit JSON.
 *
 * Response shape matches the frontend `TrajectoryFrame` type exactly so the
 * client swap is a pure replacement of the Mosaic-coordinator call with a
 * fetch.
 */

import { getOrCreateObsmLoader, parseDimIndex } from "./scatter.ts";
import type { ViewerState } from "../state.ts";

interface TrajectoryFrame {
  rowIndex: number;
  t: number;
  emb_x: number;
  emb_y: number;
  spatial_x: number;
  spatial_y: number;
  datasetKey: string | null;
  category?: number;
}

/**
 * Handle GET /api/trajectory
 *
 * Query params:
 *   track_id     — required int
 *   fov_name     — required string
 *   embedding    — required obsm key (e.g. X_phate)
 *   x_col, y_col — required obsm dim columns ending in _<dim>
 *   dataset      — optional dataset key (multi-dataset filter)
 *   category_col — optional numeric obs column to include as `category`
 */
export async function handleTrajectory(url: URL, state: ViewerState, signal: AbortSignal): Promise<Response> {
  // ── Parse params ──────────────────────────────────────────────────────
  const trackIdRaw = url.searchParams.get("track_id");
  const fovName = url.searchParams.get("fov_name");
  const embedding = url.searchParams.get("embedding");
  const xCol = url.searchParams.get("x_col");
  const yCol = url.searchParams.get("y_col");
  const datasetKey = url.searchParams.get("dataset");
  const categoryCol = url.searchParams.get("category_col");

  if (!trackIdRaw || !fovName || !embedding || !xCol || !yCol) {
    return Response.json(
      { error: "Missing required params: track_id, fov_name, embedding, x_col, y_col" },
      { status: 400 },
    );
  }

  const trackId = Number(trackIdRaw);
  if (!Number.isInteger(trackId)) {
    return Response.json({ error: `track_id must be an integer (got "${trackIdRaw}")` }, { status: 400 });
  }

  if (!state.availableObsmKeys.includes(embedding)) {
    return Response.json(
      { error: `Unknown embedding "${embedding}". Available: [${state.availableObsmKeys.join(", ") || "none"}]` },
      { status: 404 },
    );
  }

  const xDim = parseDimIndex(xCol);
  const yDim = parseDimIndex(yCol);
  if (xDim === null || yDim === null) {
    return Response.json(
      { error: `x_col / y_col must end in "_<dim>" (got x_col="${xCol}", y_col="${yCol}")` },
      { status: 400 },
    );
  }

  // Category column must be in the known obs column set — prevents arbitrary
  // identifier injection into the SELECT clause below.
  if (categoryCol != null && !state.obsColumns.includes(categoryCol)) {
    return Response.json({ error: `Unknown category_col "${categoryCol}". Must be in obs columns.` }, { status: 400 });
  }

  // ── Trajectory metadata (via DuckDB VIEW) ─────────────────────────────
  try {
    const spatialX = state.spatial?.x ?? "x";
    const spatialY = state.spatial?.y ?? "y";
    const escFov = fovName.replaceAll("'", "''");
    const datasetFilter = datasetKey ? ` AND _dataset = '${datasetKey.replaceAll("'", "''")}'` : "";
    const catSelect = categoryCol != null ? `, "${categoryCol}" AS category` : "";

    const sql =
      `SELECT __row_index__ AS "rowIndex", t, ` +
      `"${spatialX}" AS spatial_x, "${spatialY}" AS spatial_y, ` +
      `_dataset AS "datasetKey"${catSelect} ` +
      `FROM dataset ` +
      `WHERE track_id = ${trackId} AND fov_name = '${escFov}'${datasetFilter} ` +
      `ORDER BY t ASC`;

    const metadataRows = await state.store.queryJson(sql);

    if (signal.aborted) return new Response("aborted", { status: 499 });

    if (metadataRows.length === 0) {
      return Response.json([] as TrajectoryFrame[]);
    }

    // ── Obsm positions (via ObsmSliceLoader — shared with scatter-positions)
    const loader = await getOrCreateObsmLoader(state, embedding);
    const [xs, ys] = await Promise.all([loader.loadColumn(xDim, signal), loader.loadColumn(yDim, signal)]);

    if (signal.aborted) return new Response("aborted", { status: 499 });

    // ── Merge ─────────────────────────────────────────────────────────
    const frames: TrajectoryFrame[] = metadataRows.map((row) => {
      const rowIndex = Number(row.rowIndex);
      const ex = xs[rowIndex];
      const ey = ys[rowIndex];
      const frame: TrajectoryFrame = {
        rowIndex,
        t: Number(row.t),
        emb_x: Number.isFinite(ex) ? ex : 0,
        emb_y: Number.isFinite(ey) ? ey : 0,
        spatial_x: Number(row.spatial_x),
        spatial_y: Number(row.spatial_y),
        datasetKey: typeof row.datasetKey === "string" ? row.datasetKey : null,
      };
      if (categoryCol != null && row.category != null) {
        frame.category = Number(row.category);
      }
      return frame;
    });

    return Response.json(frames);
  } catch (err) {
    if (signal.aborted) return new Response("aborted", { status: 499 });
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[trajectory] ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
