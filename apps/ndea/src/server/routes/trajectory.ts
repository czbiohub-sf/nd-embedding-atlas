/**
 * GET /api/trajectory: the frames of one (track_id, fov_name) track, ordered
 * by t. Each frame carries its `__row_index__`; the scatter reads the
 * embedding position from its own loaded columns by that row, so the path
 * sits exactly on the drawn points in 2D and 3D.
 */

import { TrajectoryResponseSchema, type TrajectoryFrame } from "@ndea/protocol";
import type { ServerSession } from "../state.ts";
import { routeError } from "../request-body.ts";
import { quoteIdent } from "@ndea/protocol";

/**
 * Handle GET /api/trajectory
 *
 * Query params:
 *   track_id    : required int
 *   fov_name    : required string
 *   dataset     : optional dataset key (multi-dataset filter)
 *   category_col: optional numeric obs column to include as `category`
 */
export async function handleTrajectory(url: URL, state: ServerSession, signal: AbortSignal): Promise<Response> {
  const trackIdRaw = url.searchParams.get("track_id");
  const fovName = url.searchParams.get("fov_name");
  const datasetKey = url.searchParams.get("dataset");
  const categoryCol = url.searchParams.get("category_col");

  if (!trackIdRaw || !fovName) {
    return Response.json({ error: "Missing required params: track_id, fov_name" }, { status: 400 });
  }

  const trackId = Number(trackIdRaw);
  if (!Number.isInteger(trackId)) {
    return Response.json({ error: `track_id must be an integer (got "${trackIdRaw}")` }, { status: 400 });
  }
  if (categoryCol != null && !state.store.columns().has(categoryCol)) {
    return Response.json({ error: `Unknown category_col "${categoryCol}"` }, { status: 400 });
  }

  try {
    const spatialX = quoteIdent(state.spatial?.x ?? "x");
    const spatialY = quoteIdent(state.spatial?.y ?? "y");
    const escFov = fovName.replaceAll("'", "''");
    const datasetFilter = datasetKey ? ` AND _dataset = '${datasetKey.replaceAll("'", "''")}'` : "";
    const catSelect = categoryCol != null ? `, ${quoteIdent(categoryCol)} AS category` : "";

    const sql =
      `SELECT __row_index__ AS "rowIndex", t, ` +
      `${spatialX} AS spatial_x, ${spatialY} AS spatial_y, ` +
      `_dataset AS "datasetKey"${catSelect} ` +
      `FROM dataset ` +
      `WHERE track_id = ${trackId} AND fov_name = '${escFov}'${datasetFilter} ` +
      `ORDER BY t ASC`;

    const rows = await state.store.querySingleJson(sql);
    if (signal.aborted) return new Response("aborted", { status: 499 });

    const frames: TrajectoryFrame[] = rows.map((row) => {
      const frame: TrajectoryFrame = {
        rowIndex: Number(row.rowIndex),
        t: Number(row.t),
        spatial_x: Number(row.spatial_x),
        spatial_y: Number(row.spatial_y),
        datasetKey: typeof row.datasetKey === "string" ? row.datasetKey : null,
      };
      if (categoryCol != null && row.category != null) {
        frame.category = Number(row.category);
      }
      return frame;
    });

    TrajectoryResponseSchema.parse(frames);
    return Response.json(frames);
  } catch (err) {
    return routeError("trajectory", err, signal);
  }
}
