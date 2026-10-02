import { useQuery } from "@tanstack/react-query";
import { vec3 } from "gl-matrix";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useNodeFocus } from "../query/useNodeFocus";
import { useImageViewerHost, useImageViewerServices } from "./context";
import { capabilitiesOf } from "@ndea/sdk";
import { ObsInfoSchema } from "@ndea/protocol";
import type { OrbitControls } from "./viewer/orbit-controls";
import { useBboxLayer } from "./viewer/useBboxLayer";
import { useFovLoader } from "./viewer/useFovLoader";
import { useViewer } from "./viewer/useViewer";
import { shouldRevealViewer } from "./focus-behavior";
import { resolveObservationImage } from "./observation-image";

/** Fixed camera view radius in pixels (independent of crop slider). */
const CAMERA_VIEW_HALF = 150;

interface Props {
  cropSize: number;
  /** Draw the bounding box overlay. Off → never draw, regardless of data. */
  showBbox: boolean;
  /** If set, this viewer only responds to cells from this dataset key. */
  datasetKey?: string;
}

function ViewerPresentationCover({ ready, presentationKey }: { ready: boolean; presentationKey: string }) {
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let thirdFrame = 0;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        thirdFrame = requestAnimationFrame(() => setRevealedKey(presentationKey));
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      cancelAnimationFrame(thirdFrame);
    };
  }, [ready, presentationKey]);

  return ready && revealedKey === presentationKey ? null : (
    <div className="pointer-events-none absolute inset-0 z-10 bg-node-surface" />
  );
}

export function SingleCropViewer({ cropSize, showBbox, datasetKey }: Props) {
  const services = useImageViewerServices();
  const session = services.useSessionSnapshot();
  const { state: viewerState, actions, meta } = useViewer();
  const { metadata } = useImageViewerHost().data;

  // Focus source: scoped to this instance's host (its focus WIRE is the input),
  // so deleting the wire genuinely disconnects the viewer (C6).
  const host = useImageViewerHost();
  const focusedRowIndex = useNodeFocus(host);

  // ── Fetch obs info ────────────────────────────────────────────────
  const { data: obsInfo } = useQuery({
    queryKey: ["obs", focusedRowIndex],
    queryFn: async () => {
      return ObsInfoSchema.parse(await services.loadCrop(focusedRowIndex!));
    },
    enabled: focusedRowIndex != null,
    staleTime: 10_000,
  });

  const image = resolveObservationImage(metadata, obsInfo, datasetKey);
  const isForThisDataset = image != null;
  const activeStoreName = image?.store.name;

  // ── Derive source URL and OME version ────────────────────────────
  // Prefer the FOV's own scale (idetik reads it from this FOV's
  // coordinateTransformations) over the plate-level fallback. The plate scale
  // is a snapshot of the *first* FOV at startup and disagrees with later FOVs
  // when the dataset mixes magnifications / objectives.
  const plateScale = metadata.plate_pixel_scale ?? { x: 1, y: 1 };
  const omeVersion = image?.store.ome_version;
  const fovName = image?.fovName ?? null;
  const sourceUrl = image ? `${window.location.origin}${image.store.mount}/${image.fovName}` : null;
  const resolvedChannels = image?.channels;

  // The loader takes the canonical FOV name and the store name: `dataset_key`
  // picks the plate mount server-side, mirroring the crop path.
  const sourceReady = useFovLoader({
    sourceUrl,
    fovName,
    datasetKey: activeStoreName,
    plateChannels: resolvedChannels,
    omeVersion,
    loadChannelStats: services.loadChannelStats,
  });

  const scale = viewerState.bounds.scale ?? plateScale;

  const { updateBbox, clearBbox } = useBboxLayer({
    idetik: meta.runtime,
    scale,
    translation: viewerState.bounds.translation,
  });

  // Whether this dataset resolved obs centroids (x/y). Combined with the
  // per-obs `bbox`, this decides if there is anything to draw at all: a
  // dataset with neither (no crops) draws no box, and rows that lack both
  // never show a stale fallback rectangle at the origin.
  const hasCentroid = capabilitiesOf(metadata).has("spatial");

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
  // Camera only. Deliberately does NOT depend on showBbox/cropSize-for-2d so
  // that toggling or resizing the bounding box never moves the camera: the
  // box draw lives in its own effect below.
  useLayoutEffect(() => {
    if (!isForThisDataset || !obsInfo || !viewerState.initialized) return;

    if (viewerState.viewMode === "2d") {
      if (obsInfo.bbox) {
        const { y_min, x_min, y_max, x_max } = obsInfo.bbox;
        const pad = 50;
        frameRegion((x_min + x_max) / 2, (y_min + y_max) / 2, (x_max - x_min) / 2 + pad, (y_max - y_min) / 2 + pad);
      } else {
        frameRegion(obsInfo.x, obsInfo.y, CAMERA_VIEW_HALF, CAMERA_VIEW_HALF);
      }
    } else {
      // 3D: position orbit camera to look at observation center.
      // Same translation correction as the 2D path: see frameRegion above.
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
    frameRegion,
    scale.x,
    scale.y,
    tx,
    ty,
    meta.viewport,
  ]);

  // ── Effect: Bounding-box overlay (2D) ─────────────────────────────
  // Decoupled from camera framing so toggling / resizing the box never moves
  // the camera. Draws only when enabled AND there is real geometry (explicit
  // bbox, or a centroid to synthesize one); otherwise hides it.
  useEffect(() => {
    if (!isForThisDataset || !obsInfo || !viewerState.initialized) return;
    if (viewerState.viewMode !== "2d") return;
    if (showBbox && (obsInfo.bbox || hasCentroid)) {
      updateBbox(obsInfo.x, obsInfo.y, cropSize / 2, obsInfo.bbox);
    } else {
      clearBbox();
    }
  }, [
    isForThisDataset,
    obsInfo,
    cropSize,
    showBbox,
    hasCentroid,
    viewerState.initialized,
    viewerState.viewMode,
    updateBbox,
    clearBbox,
  ]);

  // ── Effect: Sync T index from selected observation ──────────────
  useEffect(() => {
    if (!isForThisDataset) return;
    if (obsInfo) {
      actions.setTIndex(obsInfo.t ?? 0);
    }
  }, [isForThisDataset, obsInfo, actions]);

  // ── Effect: Follow observation during trajectory playback ────────
  const trajectory = session.trajectories[datasetKey ?? ""] ?? null;
  useEffect(() => {
    if (!isForThisDataset || !trajectory || !obsInfo) return;
    const frame = trajectory.points.find((p) => p.t === trajectory.tIndex);
    if (!frame) return;
    // Drive the viewer T index so the image updates alongside the bbox
    actions.setTIndex(trajectory.tIndex);
    // Only update bbox in 2D mode, and only when the overlay is enabled.
    if (viewerState.viewMode === "2d") {
      if (showBbox) updateBbox(frame.spatial_x, frame.spatial_y, cropSize / 2);
      else clearBbox();
    }
  }, [
    isForThisDataset,
    trajectory?.tIndex,
    trajectory?.points,
    cropSize,
    showBbox,
    obsInfo,
    updateBbox,
    clearBbox,
    viewerState.viewMode,
    trajectory,
    actions,
  ]);

  // ── Placeholder when this viewer is for a different dataset ──────
  if (!isForThisDataset) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
        <span>Select a cell</span>
      </div>
    );
  }

  if (focusedRowIndex == null) return null;
  const ready = shouldRevealViewer({
    observationReady: obsInfo != null,
    sourceReady,
    aggregateState: viewerState.aggregateState,
  });
  return (
    <ViewerPresentationCover
      ready={ready}
      presentationKey={`${focusedRowIndex}:${sourceUrl ?? ""}:${viewerState.generation}`}
    />
  );
}
