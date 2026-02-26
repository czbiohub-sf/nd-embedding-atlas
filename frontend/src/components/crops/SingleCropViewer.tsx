import { useCallback, useEffect } from "react";
import useSWR from "swr";
import { useBboxLayer } from "../../hooks/useBboxLayer";
import { useDashboard } from "../../hooks/useDashboard";
import { useFovLoader } from "../../hooks/useFovLoader";
import { useViewer } from "../../hooks/useViewer";
import { jsonFetcher } from "../../lib/fetcher";
import type { CellInfo } from "../../types";

/** Fixed camera view radius in pixels (independent of crop slider). */
const CAMERA_VIEW_HALF = 150;

interface Props {
    cropSize: number;
}

export function SingleCropViewer({ cropSize }: Props) {
    const { state: dashState } = useDashboard();
    const { state: viewerState, actions, meta } = useViewer();
    const { highlightId, metadata } = dashState;

    // ── Fetch cell info ───────────────────────────────────────────────
    const { data: cellInfo } = useSWR<CellInfo>(highlightId ? `/api/cell/${highlightId}` : null, jsonFetcher, {
        keepPreviousData: true,
    });

    // ── Derive source URL ─────────────────────────────────────────────
    const scale = metadata.plate_pixel_scale ?? { x: 1, y: 1 };
    const sourceUrl = cellInfo ? `${window.location.origin}/plate/${cellInfo.fov_name}` : null;

    // ── Hooks for imperative plumbing ─────────────────────────────────
    useFovLoader({
        sourceUrl,
        viewerState,
        actions,
        plateChannels: metadata.plate_channels,
    });

    const { updateBbox } = useBboxLayer({
        viewport: meta.viewport,
        orthoCamera: meta.orthoCamera,
        scale,
    });

    // ── Helper: camera framing ────────────────────────────────────────
    // Sets the camera frame directly — Idetik's internal setAspectRatio
    // (called automatically on resize) handles aspect correction.
    const frameRegion = useCallback(
        (cx: number, cy: number, hx: number, hy: number) => {
            actions.setFrame((cx - hx) * scale.x, (cx + hx) * scale.x, (cy + hy) * scale.y, (cy - hy) * scale.y);
        },
        [actions, scale.x, scale.y],
    );

    // ── Effect: Cell framing (bbox + camera on every cell change) ─────
    useEffect(() => {
        if (!cellInfo || !viewerState.initialized) return;

        updateBbox(cellInfo.x, cellInfo.y, cropSize / 2, cellInfo.bbox);

        if (cellInfo.bbox) {
            const { y_min, x_min, y_max, x_max } = cellInfo.bbox;
            const pad = 50;
            frameRegion((x_min + x_max) / 2, (y_min + y_max) / 2, (x_max - x_min) / 2 + pad, (y_max - y_min) / 2 + pad);
        } else {
            frameRegion(cellInfo.x, cellInfo.y, CAMERA_VIEW_HALF, CAMERA_VIEW_HALF);
        }
    }, [
        cellInfo?.x,
        cellInfo?.y,
        cellInfo?.bbox?.x_min,
        cellInfo?.bbox?.y_min,
        cellInfo?.bbox?.x_max,
        cellInfo?.bbox?.y_max,
        cropSize,
        viewerState.initialized,
        updateBbox,
        frameRegion,
        cellInfo?.bbox,
        cellInfo,
    ]);

    // ── Effect: Sync T index from selected cell ───────────────────────
    useEffect(() => {
        if (cellInfo) {
            actions.setTIndex(cellInfo.t ?? 0);
        }
    }, [cellInfo?.t, actions, cellInfo]);

    // ── Effect: Follow cell during trajectory playback ────────────────
    const { trajectory } = dashState;
    useEffect(() => {
        if (!trajectory || !cellInfo) return;
        const frame = trajectory.points.find((p) => p.t === trajectory.tIndex);
        if (!frame) return;
        updateBbox(frame.spatial_x, frame.spatial_y, cropSize / 2);
    }, [trajectory?.tIndex, trajectory?.points, cropSize, cellInfo, updateBbox, trajectory]);

    if (!highlightId || !cellInfo) return null;
    return null;
}
