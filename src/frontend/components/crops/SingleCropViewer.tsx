import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { vec3 } from "gl-matrix";
import { useCallback, useEffect } from "react";
import { selectTrajectory } from "../../dashboard/DashboardContext";
import { useDashboard } from "../../hooks/useDashboard";
import { ObsInfoSchema } from "../../../protocol/index.ts";
import type { OrbitControls } from "../viewer/OrbitControls";
import { useBboxLayer } from "../viewer/useBboxLayer";
import { useFovLoader } from "../viewer/useFovLoader";
import { useViewer } from "../viewer/useViewer";

/** Fixed camera view radius in pixels (independent of crop slider). */
const CAMERA_VIEW_HALF = 150;

interface Props {
  cropSize: number;
  /** If set, this viewer only responds to cells from this dataset key. */
  datasetKey?: string;
}

export function SingleCropViewer({ cropSize, datasetKey }: Props) {
  const { state: dashState } = useDashboard();
  const { state: viewerState, actions, meta } = useViewer();
  const { highlightId, metadata } = dashState;

  // ── Fetch obs info ────────────────────────────────────────────────
  const { data: obsInfo } = useQuery({
    queryKey: ["obs", highlightId],
    queryFn: async () => {
      const r = await fetch(`/api/obs/${highlightId}`);
      return ObsInfoSchema.parse(await r.json());
    },
    enabled: !!highlightId,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

  // ── Dataset filtering ─────────────────────────────────────────────
  // When datasetKey is set, this viewer only drives itself for cells
  // from the matching dataset. Derive from store_index → plate_stores[].name.
  const activeStoreName = metadata.plate_stores?.[obsInfo?.store_index ?? 0]?.name;
  const isForThisDataset = !datasetKey || activeStoreName === datasetKey;

  // ── Derive source URL and OME version ────────────────────────────
  // Prefer the FOV's own scale (idetik reads it from this FOV's
  // coordinateTransformations) over the plate-level fallback. The plate scale
  // is a snapshot of the *first* FOV at startup and disagrees with later FOVs
  // when the dataset mixes magnifications / objectives.
  const plateScale = metadata.plate_pixel_scale ?? { x: 1, y: 1 };
  const activeStore = metadata.plate_stores?.[obsInfo?.store_index ?? 0];
  const mountPrefix = activeStore ? activeStore.mount : "/plate";
  const omeVersion = activeStore?.ome_version ?? metadata.plate_ome_version;

  // Gate sourceUrl — null prevents useFovLoader from loading the wrong plate.
  const sourceUrl = isForThisDataset && obsInfo ? `${window.location.origin}${mountPrefix}/${obsInfo.fov_name}` : null;

  // ── Hooks for imperative plumbing ─────────────────────────────────
  // Resolve per-dataset channels when available, falling back to global plate_channels
  const resolvedChannels =
    (activeStoreName ? metadata.dataset_channels?.[activeStoreName] : undefined) ?? metadata.plate_channels;

  useFovLoader({
    sourceUrl,
    plateChannels: resolvedChannels,
    omeVersion,
  });

  const scale = viewerState.bounds.scale ?? plateScale;

  const { updateBbox } = useBboxLayer({
    idetik: meta.runtime,
    scale,
    translation: viewerState.bounds.translation,
  });

  // ── Helper: 2D camera framing ───────────────────────────────────
  // obs.x / obs.y are FOV-local pixel coordinates; idetik renders the FOV at
  // its world-space origin from `coordinateTransformations.translation`. Add
  // that translation so the camera lines up with the image instead of (0,0).
  const tx = viewerState.bounds.translation?.x ?? 0;
  const ty = viewerState.bounds.translation?.y ?? 0;
  const frameRegion = useCallback(
    (cx: number, cy: number, hx: number, hy: number) => {
      actions.setFrame(
        (cx - hx) * scale.x + tx,
        (cx + hx) * scale.x + tx,
        (cy + hy) * scale.y + ty,
        (cy - hy) * scale.y + ty,
      );
    },
    [actions, scale.x, scale.y, tx, ty],
  );

  // ── Effect: Observation framing (mode-aware) ──────────────────────
  useEffect(() => {
    if (!isForThisDataset || !obsInfo || !viewerState.initialized) return;

    if (viewerState.viewMode === "2d") {
      updateBbox(obsInfo.x, obsInfo.y, cropSize / 2, obsInfo.bbox);

      if (obsInfo.bbox) {
        const { y_min, x_min, y_max, x_max } = obsInfo.bbox;
        const pad = 50;
        frameRegion((x_min + x_max) / 2, (y_min + y_max) / 2, (x_max - x_min) / 2 + pad, (y_max - y_min) / 2 + pad);
      } else {
        frameRegion(obsInfo.x, obsInfo.y, CAMERA_VIEW_HALF, CAMERA_VIEW_HALF);
      }
    } else {
      // 3D: position orbit camera to look at observation center.
      // Same translation correction as the 2D path — see frameRegion above.
      const cx = obsInfo.x * scale.x + tx;
      const cy = obsInfo.y * scale.y + ty;
      const controls = meta.viewport?.cameraControls;
      const hasLookAt = controls && "lookAt" in controls;
      if (hasLookAt) {
        const radius = cropSize * Math.max(scale.x, scale.y) * 1.5;
        (controls as OrbitControls).lookAt(vec3.fromValues(cx, cy, 0), radius);
      }
    }
  }, [
    isForThisDataset,
    obsInfo,
    cropSize,
    viewerState.initialized,
    viewerState.viewMode,
    updateBbox,
    frameRegion,
    scale.x,
    scale.y,
    tx,
    ty,
    meta.viewport,
  ]);

  // ── Effect: Sync T index from selected observation ──────────────
  useEffect(() => {
    if (!isForThisDataset) return;
    if (obsInfo) {
      actions.setTIndex(obsInfo.t ?? 0);
    }
  }, [isForThisDataset, obsInfo, actions]);

  // ── Effect: Follow observation during trajectory playback ────────
  const { trajectories } = dashState;
  const trajectory = selectTrajectory(trajectories, datasetKey);
  useEffect(() => {
    if (!isForThisDataset || !trajectory || !obsInfo) return;
    const frame = trajectory.points.find((p) => p.t === trajectory.tIndex);
    if (!frame) return;
    // Drive the viewer T index so the image updates alongside the bbox
    actions.setTIndex(trajectory.tIndex);
    // Only update bbox in 2D mode
    if (viewerState.viewMode === "2d") {
      updateBbox(frame.spatial_x, frame.spatial_y, cropSize / 2);
    }
  }, [
    isForThisDataset,
    trajectory?.tIndex,
    trajectory?.points,
    cropSize,
    obsInfo,
    updateBbox,
    viewerState.viewMode,
    trajectory,
    actions,
  ]);

  // ── Placeholder when this viewer is for a different dataset ──────
  if (!isForThisDataset) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs">
        <span>Select a cell</span>
      </div>
    );
  }

  if (!highlightId || !obsInfo) return null;
  return null;
}
