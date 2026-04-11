import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Coordinator } from "@uwdata/mosaic-core";
import { useMemo } from "react";
import { selectAnyTrajectory } from "../../dashboard/DashboardContext";
import { useDashboard } from "../../hooks/useDashboard";
import { toRows } from "../../lib/mosaic-helpers";
import type { Metadata, TrajectoryFrame } from "../../types";
import { trajectoryKeys } from "./queryKeys";

interface UseTrajectoryLoaderOptions {
  coordinator: Coordinator;
  table: string;
  xCol: string;
  yCol: string;
  categoryCol: string | null;
  metadata: Metadata;
}

/** Build SELECT aliases for all loaded embedding coordinate columns. */
function buildEmbeddingSelects(metadata: Metadata): string[] {
  const selects: string[] = [];
  for (const entry of Object.values(metadata.obsm)) {
    if (!entry.loaded || entry.n_dims == null) continue;
    for (let i = 0; i < Math.min(entry.n_dims, 3); i++) {
      const col = `${entry.prefix}_${i}`;
      selects.push(col);
    }
  }
  return selects;
}

/** Raw trajectory row from DuckDB — embedding coords are flat top-level columns. */
interface RawTrajectoryRow {
  rowIndex?: number;
  spatial_x: number;
  spatial_y: number;
  t: number;
  datasetKey?: string;
  category?: number;
  [key: string]: unknown;
}

interface UseTrajectoryLoaderResult {
  showTrajectory: (trackId: number, fovName: string, clickedT?: number, datasetKey?: string) => Promise<void>;
  activeIndex: number | null;
}

/**
 * Manages trajectory loading and active-index derivation.
 *
 * Queries DuckDB for the full trajectory of a given (trackId, fovName) pair,
 * stores the result in DashboardContext, and derives the activeIndex from the
 * current tIndex in trajectory state.
 *
 * Uses useMutation so there is no manual cancelled flag, and trajectory data
 * is cached in TanStack Query cache keyed by trajectoryKeys.track.
 */
export function useTrajectoryLoader(opts: UseTrajectoryLoaderOptions): UseTrajectoryLoaderResult {
  const { coordinator, table, categoryCol, metadata } = opts;
  const { state, actions } = useDashboard();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (params: { trackId: number; fovName: string; clickedT?: number; datasetKey?: string }) => {
      const { trackId, fovName, datasetKey } = params;
      const key = trajectoryKeys.track(table, trackId, fovName);

      // Return cached rows if available
      const cached = queryClient.getQueryData<TrajectoryFrame[]>(key);
      if (cached) return { rows: cached, params };

      const spatialX = metadata.spatial?.x_col ?? "x";
      const spatialY = metadata.spatial?.y_col ?? "y";
      const catSelect = categoryCol ? `, ${categoryCol} AS category` : "";
      const safeFovName = String(fovName).replace(/'/g, "''");
      const safeTrackId = Number.isFinite(trackId) ? trackId : 0;
      const datasetFilter = datasetKey ? ` AND _dataset = '${String(datasetKey).replace(/'/g, "''")}'` : "";

      // Select ALL loaded embedding coordinate columns so every panel can draw the trajectory
      const embCols = buildEmbeddingSelects(metadata);
      const embSelect = embCols.length > 0 ? `, ${embCols.join(", ")}` : "";

      const baseSql = `SELECT __row_index__ AS "rowIndex", ${spatialX} AS spatial_x, ${spatialY} AS spatial_y, t, _dataset AS datasetKey${embSelect}`;
      const whereClause = `FROM ${table} WHERE track_id = ${safeTrackId} AND fov_name = '${safeFovName}'${datasetFilter} ORDER BY t ASC`;
      const sql = `${baseSql}${catSelect} ${whereClause}`;

      let result;
      const fallbackSql = `SELECT __row_index__ AS "rowIndex", ${spatialX} AS spatial_x, ${spatialY} AS spatial_y, t, _dataset AS datasetKey ${whereClause}`;
      try {
        result = await coordinator.query(sql, { type: "json" });
      } catch (e) {
        // Column missing from VIEW (stale category col, unloaded embedding) — retry with minimal columns
        if (String(e).includes("not found in FROM clause")) {
          result = await coordinator.query(fallbackSql, { type: "json" });
        } else {
          throw e;
        }
      }

      // Build TrajectoryFrame[] with embedding coords grouped into `coords` record
      const rawRows = toRows<RawTrajectoryRow>(result);
      const rows: TrajectoryFrame[] = rawRows.map((r) => {
        const coords: Record<string, number> = {};
        for (const col of embCols) {
          const val = r[col];
          if (typeof val === "number") coords[col] = val;
        }
        return {
          t: r.t,
          coords,
          spatial_x: r.spatial_x,
          spatial_y: r.spatial_y,
          category: r.category,
          rowIndex: r.rowIndex,
          datasetKey: r.datasetKey,
        };
      });

      queryClient.setQueryData(key, rows);
      return { rows, params };
    },
    onSuccess: ({ rows, params }) => {
      const { trackId, fovName, clickedT } = params;
      if (rows.length > 0) {
        const initialT = clickedT != null && rows.some((r) => r.t === clickedT) ? clickedT : rows[0].t;
        actions.setTrajectory({
          trackId,
          fovName,
          datasetKey: rows[0]?.datasetKey,
          tIndex: initialT,
          points: rows,
        });
      }
    },
  });

  const showTrajectory = async (trackId: number, fovName: string, clickedT?: number, datasetKey?: string) => {
    await mutation.mutateAsync({ trackId, fovName, clickedT, datasetKey });
  };

  const trajectory = selectAnyTrajectory(state.trajectories);
  const activeIndex = useMemo(() => {
    if (!trajectory) return null;
    const idx = trajectory.points.findIndex((p) => p.t === trajectory.tIndex);
    return idx >= 0 ? idx : null;
  }, [trajectory]);

  return { showTrajectory, activeIndex };
}
