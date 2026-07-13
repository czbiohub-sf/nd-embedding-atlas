import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TrajectoryResponseSchema } from "@ndea/protocol";
import { useMemo } from "react";
import { selectAnyTrajectory } from "@/dashboard/DashboardContext";
import { useDashboard } from "@/hooks/useDashboard";
import type { TrajectoryFrame } from "@/types";
import { trajectoryKeys } from "@/lib/query-keys";

interface UseTrajectoryLoaderOptions {
  /** Obsm key for the active embedding (e.g. `X_phate`). */
  embedding: string;
  xCol: string;
  yCol: string;
  categoryCol: string | null;
}

interface UseTrajectoryLoaderResult {
  showTrajectory: (trackId: number, fovName: string, clickedT?: number, datasetKey?: string) => Promise<void>;
  activeIndex: number | null;
}

/**
 * Manages trajectory loading and active-index derivation.
 *
 * Fetches `/api/trajectory` (server-side join of DuckDB metadata + obsm
 * positions) for a given (trackId, fovName) pair, stores the result in
 * DashboardContext, and derives the activeIndex from the current tIndex.
 *
 * Previously built Mosaic SQL on the client and paid a Binder Error
 * whenever the embedding's obsm columns weren't materialized into the
 * `dataset` VIEW (which, as of the scatter-positions refactor, is always).
 * The endpoint owns schema knowledge now; this hook is thin.
 */
export function useTrajectoryLoader(opts: UseTrajectoryLoaderOptions): UseTrajectoryLoaderResult {
  const { embedding, xCol, yCol, categoryCol } = opts;
  const { state, actions } = useDashboard();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (params: { trackId: number; fovName: string; clickedT?: number; datasetKey?: string }) => {
      const { trackId, fovName, datasetKey } = params;
      const key = trajectoryKeys.track(embedding, trackId, fovName);

      const cached = queryClient.getQueryData<TrajectoryFrame[]>(key);
      if (cached) return { rows: cached, params };

      const search = new URLSearchParams({
        track_id: String(trackId),
        fov_name: fovName,
        embedding,
        x_col: xCol,
        y_col: yCol,
      });
      if (datasetKey != null) search.set("dataset", datasetKey);
      if (categoryCol != null) search.set("category_col", categoryCol);

      const res = await fetch(`/api/trajectory?${search.toString()}`);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`[/api/trajectory] ${res.status} ${res.statusText}: ${body}`);
      }
      const rows = TrajectoryResponseSchema.parse(await res.json());

      queryClient.setQueryData(key, rows);
      return { rows, params };
    },
    onSuccess: ({ rows, params }) => {
      const { trackId, fovName, clickedT } = params;
      if (rows.length === 0) return;
      const initialT = clickedT != null && rows.some((r) => r.t === clickedT) ? clickedT : rows[0].t;
      actions.setTrajectory({
        trackId,
        fovName,
        datasetKey: rows[0].datasetKey ?? undefined,
        tIndex: initialT,
        points: rows,
      });
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
