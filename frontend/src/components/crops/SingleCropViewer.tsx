import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { vec3 } from "gl-matrix";
import { useCallback, useEffect } from "react";
import { selectTrajectory } from "../../dashboard/DashboardContext";
import { useDashboard } from "../../hooks/useDashboard";
import { ObsInfoSchema } from "../../lib/schemas";
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
  const activeStore = metadata.plate_stores?.[obsInfo?.store_index ?? 0];
  const scale = activeStore?.pixel_scale ?? metadata.plate_pixel_scale ?? { x: 1, y: 1 };
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

  // Prefer OME-derived scale (from idetik dims) over backend pixel_scale for camera framing.
  // This ensures the camera uses the same coordinate system as idetik's rendering.
  const { worldOrigin, worldScale } = viewerState;
  const effectiveScale = worldScale ?? scale;

  const { updateBbox } = useBboxLayer({
    viewport: meta.viewport,
    scale: effectiveScale,
    worldOrigin,
  });

  // ── Helper: 2D camera framing ───────────────────────────────────
  // idetik places the image at worldOrigin (from OME translation), so we
  // must offset the camera by that amount to look at the right world coords.
  const frameRegion = useCallback(
    (cx: number, cy: number, hx: number, hy: number) => {
      const left = worldOrigin.x + (cx - hx) * effectiveScale.x;
      const right = worldOrigin.x + (cx + hx) * effectiveScale.x;
      const bottom = worldOrigin.y + (cy + hy) * effectiveScale.y;
      const top = worldOrigin.y + (cy - hy) * effectiveScale.y;
      actions.setFrame(left, right, bottom, top);
    },
    [actions, effectiveScale.x, effectiveScale.y, worldOrigin.x, worldOrigin.y],
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
      // 3D: position orbit camera to look at observation center
      const cx = worldOrigin.x + obsInfo.x * effectiveScale.x;
      const cy = worldOrigin.y + obsInfo.y * effectiveScale.y;
      const controls = meta.viewport?.cameraControls;
      const hasLookAt = controls && "lookAt" in controls;
      console.log("[3d] lookAt", { cx, cy, hasLookAt, controls: !!controls });
      if (hasLookAt) {
        const radius = cropSize * Math.max(effectiveScale.x, effectiveScale.y) * 1.5;
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
    effectiveScale.x,
    effectiveScale.y,
    meta.viewport,
  ]);

  // ── Effect: Sync T index from selected observation ──────────────
  useEffect(() => {
    if (!isForThisDataset) return;
    if (obsInfo) {
      actions.setTIndex(obsInfo.t ?? 0);
      actions.setZIndex(obsInfo.z ?? 0);
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
