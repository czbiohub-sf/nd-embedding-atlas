import { useQuery } from "@tanstack/react-query";
import { jsonFetcher } from "../lib/fetcher";

/**
 * Fields needed to start a trajectory trace for a highlighted point.
 *
 * Populated only when the current dataset has `track_id` and `fov_name`
 * columns — otherwise `trackable` is false and the toolbar toggle stays
 * disabled.
 */
export interface HighlightedPointMeta {
  trackable: boolean;
  trackId?: number;
  fovName?: string;
  t?: number;
  datasetKey?: string;
}

const EMPTY: HighlightedPointMeta = { trackable: false };

/**
 * Fetches `/api/obs/{highlightId}/detail` for the currently-highlighted
 * point and extracts the trajectory-relevant fields.
 *
 * Previously lived inline inside PointInfoPane. Pulled out so the
 * trajectory toggle in ScatterOverlayControls can wire itself to the
 * highlighted point without re-mounting the old metadata card.
 */
export function useHighlightedPointMeta(highlightId: string | null): HighlightedPointMeta {
  const { data } = useQuery<Record<string, string | null>>({
    queryKey: ["obs-detail", highlightId],
    queryFn: () => jsonFetcher(`/api/obs/${highlightId}/detail`) as Promise<Record<string, string | null>>,
    enabled: highlightId != null,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  if (!data) return EMPTY;

  const trackIdRaw = data.track_id;
  const fovName = data.fov_name;
  if (!trackIdRaw || trackIdRaw === "—" || !fovName || fovName === "—") return EMPTY;

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
