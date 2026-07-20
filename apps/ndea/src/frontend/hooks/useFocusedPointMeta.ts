import { useQuery } from "@tanstack/react-query";
import type { RowIndex } from "@ndea/sdk";
import { jsonFetcher } from "../lib/fetcher";

/**
 * Fields needed to start a trajectory trace for a focused point.
 *
 * Populated only when the current dataset has `track_id` and `fov_name`
 * columns: otherwise `trackable` is false and the toolbar toggle stays
 * disabled.
 */
export interface FocusedPointMeta {
  trackable: boolean;
  trackId?: number;
  fovName?: string;
  t?: number;
  datasetKey?: string;
}

const EMPTY: FocusedPointMeta = { trackable: false };

/**
 * Fetches `/api/obs/{focusedRowIndex}/detail` for the currently focused
 * point and extracts the trajectory-relevant fields.
 *
 * Previously lived inline inside PointInfoPane. Pulled out so the
 * trajectory toggle in ScatterOverlayControls can wire itself to the
 * focused point without re-mounting the old metadata card.
 */
export function useFocusedPointMeta(focusedRowIndex: RowIndex | null): FocusedPointMeta {
  const { data } = useQuery<Record<string, string | null>>({
    queryKey: ["obs-detail", focusedRowIndex],
    queryFn: () => jsonFetcher(`/api/obs/${focusedRowIndex}/detail`) as Promise<Record<string, string | null>>,
    enabled: focusedRowIndex != null,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  if (!data) return EMPTY;

  const trackIdRaw = data.track_id;
  const fovName = data.fov_name;
  if (!trackIdRaw || trackIdRaw === ":" || !fovName || fovName === ":") return EMPTY;

  const trackId = Number(trackIdRaw);
  if (!Number.isFinite(trackId)) return EMPTY;

  return {
    trackable: true,
    trackId,
    fovName,
    t: data.t ? Number(data.t) : undefined,
    datasetKey: data._dataset ?? undefined,
  };
}
