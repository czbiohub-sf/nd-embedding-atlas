import { vec3 } from "gl-matrix";
import { useCallback, useEffect } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useBboxLayer } from "../../hooks/useBboxLayer";
import { useDashboard } from "../../hooks/useDashboard";
import { useFovLoader } from "../../hooks/useFovLoader";
import { useViewer } from "../../hooks/useViewer";
import { ObsInfoSchema } from "../../lib/schemas";
import type { OrbitControls } from "../../lib/OrbitControls";

/** Fixed camera view radius in pixels (independent of crop slider). */
const CAMERA_VIEW_HALF = 150;

interface Props {
    cropSize: number;
}

export function SingleCropViewer({ cropSize }: Props) {
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

    // ── Derive source URL and OME version ────────────────────────────
    const scale = metadata.plate_pixel_scale ?? { x: 1, y: 1 };
    const activeStore = metadata.plate_stores?.[obsInfo?.store_index ?? 0];
    const mountPrefix = activeStore ? activeStore.mount : "/plate";
    const omeVersion = activeStore?.ome_version ?? metadata.plate_ome_version;
    const sourceUrl = obsInfo ? `${window.location.origin}${mountPrefix}/${obsInfo.fov_name}` : null;

    // ── Hooks for imperative plumbing ─────────────────────────────────
    useFovLoader({
        sourceUrl,
        plateChannels: metadata.plate_channels,
        omeVersion,
    });

    const { updateBbox } = useBboxLayer({
        viewport: meta.viewport,
        scale,
    });

    // ── Helper: 2D camera framing ───────────────────────────────────
    const frameRegion = useCallback(
        (cx: number, cy: number, hx: number, hy: number) => {
            actions.setFrame((cx - hx) * scale.x, (cx + hx) * scale.x, (cy + hy) * scale.y, (cy - hy) * scale.y);
        },
        [actions, scale.x, scale.y],
    );

    // ── Effect: Observation framing (mode-aware) ──────────────────────
    useEffect(() => {
        if (!obsInfo || !viewerState.initialized) return;

        console.log("[frame] setFrame called", { x: obsInfo.x, y: obsInfo.y, t: performance.now().toFixed(1) });

        if (viewerState.viewMode === "2d") {
            updateBbox(obsInfo.x, obsInfo.y, cropSize / 2, obsInfo.bbox);

            if (obsInfo.bbox) {
                const { y_min, x_min, y_max, x_max } = obsInfo.bbox;
                const pad = 50;
                frameRegion(
                    (x_min + x_max) / 2,
                    (y_min + y_max) / 2,
                    (x_max - x_min) / 2 + pad,
                    (y_max - y_min) / 2 + pad,
                );
            } else {
                frameRegion(obsInfo.x, obsInfo.y, CAMERA_VIEW_HALF, CAMERA_VIEW_HALF);
            }
        } else {
            // 3D: position orbit camera to look at observation center
            const cx = obsInfo.x * scale.x;
            const cy = obsInfo.y * scale.y;
            const controls = meta.viewport?.cameraControls;
            const hasLookAt = controls && "lookAt" in controls;
            console.log("[3d] lookAt", { cx, cy, hasLookAt, controls: !!controls });
            if (hasLookAt) {
                const radius = cropSize * Math.max(scale.x, scale.y) * 1.5;
                (controls as OrbitControls).lookAt(vec3.fromValues(cx, cy, 0), radius);
            }
        }
    }, [
        obsInfo,
        cropSize,
        viewerState.initialized,
        viewerState.viewMode,
        updateBbox,
        frameRegion,
        scale.x,
        scale.y,
        meta.viewport,
    ]);

    // ── Effect: Sync T index from selected observation ──────────────
    useEffect(() => {
        if (obsInfo) {
            actions.setTIndex(obsInfo.t ?? 0);
        }
    }, [obsInfo, actions]);

    // ── Effect: Follow observation during trajectory playback ────────
    const { trajectory } = dashState;
    useEffect(() => {
        if (!trajectory || !obsInfo) return;
        const frame = trajectory.points.find((p) => p.t === trajectory.tIndex);
        if (!frame) return;
        // Only update bbox in 2D mode
        if (viewerState.viewMode === "2d") {
            updateBbox(frame.spatial_x, frame.spatial_y, cropSize / 2);
        }
    }, [trajectory?.tIndex, trajectory?.points, cropSize, obsInfo, updateBbox, viewerState.viewMode, trajectory]);

    if (!highlightId || !obsInfo) return null;
    return null;
}
