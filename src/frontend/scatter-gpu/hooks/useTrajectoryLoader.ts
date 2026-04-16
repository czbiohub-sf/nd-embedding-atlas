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

interface UseTrajectoryLoaderResult {
    showTrajectory: (
        trackId: number,
        fovName: string,
        clickedT?: number,
        datasetKey?: string,
    ) => Promise<void>;
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
    const { coordinator, table, xCol, yCol, categoryCol, metadata } = opts;
    const { state, actions } = useDashboard();
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationFn: async (params: {
            trackId: number;
            fovName: string;
            clickedT?: number;
            datasetKey?: string;
        }) => {
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
            const datasetFilter = datasetKey
                ? ` AND _dataset = '${String(datasetKey).replace(/'/g, "''")}'`
                : "";
            const baseSql = `SELECT __row_index__ AS "rowIndex", ${xCol} AS emb_x, ${yCol} AS emb_y, ${spatialX} AS spatial_x, ${spatialY} AS spatial_y, t, _dataset AS datasetKey`;
            const whereClause = `FROM ${table} WHERE track_id = ${safeTrackId} AND fov_name = '${safeFovName}'${datasetFilter} ORDER BY t ASC`;
            const sql = `${baseSql}${catSelect} ${whereClause}`;

            let result;
            try {
                result = await coordinator.query(sql, { type: "json" });
            } catch (e) {
                // __ev__* column missing from VIEW (stale after backend restart) — retry without it
                if (catSelect && String(e).includes("not found in FROM clause")) {
                    result = await coordinator.query(`${baseSql} ${whereClause}`, { type: "json" });
                } else {
                    throw e;
                }
            }
            const rows = toRows<TrajectoryFrame>(result);

            queryClient.setQueryData(key, rows);
            return { rows, params };
        },
        onSuccess: ({ rows, params }) => {
            const { trackId, fovName, clickedT } = params;
            if (rows.length > 0) {
                const initialT =
                    clickedT != null && rows.some((r) => r.t === clickedT) ? clickedT : rows[0].t;
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

    const showTrajectory = async (
        trackId: number,
        fovName: string,
        clickedT?: number,
        datasetKey?: string,
    ) => {
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
