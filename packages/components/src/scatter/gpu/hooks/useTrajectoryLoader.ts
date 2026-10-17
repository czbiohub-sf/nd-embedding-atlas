import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TrajectoryResponseSchema } from "@ndea/protocol";
import { useScatterSession } from "../../context";
import type { TrajectoryFrame } from "../../contracts";
import { trajectoryKeys } from "../../helpers";

interface UseTrajectoryLoaderOptions {
  categoryCol: string | null;
}

interface UseTrajectoryLoaderResult {
  showTrajectory: (trackId: number, fovName: string, clickedT?: number, datasetKey?: string) => Promise<void>;
}

/**
 * Fetches `/api/trajectory` (the track's frames from DuckDB metadata) for a
 * (trackId, fovName) pair and stores it in the dataset session. Frames carry
 * row indices only: the scatter reads their positions from its own columns.
 */
export function useTrajectoryLoader(opts: UseTrajectoryLoaderOptions): UseTrajectoryLoaderResult {
  const { categoryCol } = opts;
  const { actions } = useScatterSession();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (params: { trackId: number; fovName: string; clickedT?: number; datasetKey?: string }) => {
      const { trackId, fovName, datasetKey } = params;
      const key = trajectoryKeys.track(trackId, fovName, categoryCol);

      const cached = queryClient.getQueryData<TrajectoryFrame[]>(key);
      if (cached) return { rows: cached, params };

      const search = new URLSearchParams({ track_id: String(trackId), fov_name: fovName });
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

  return { showTrajectory };
}
