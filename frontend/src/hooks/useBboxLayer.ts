import { type Layer, type OrthographicCamera, ProjectedLineLayer, type Viewport } from "@idetik/core";
import { useCallback, useEffect, useRef } from "react";
import type { CellBbox } from "../types";

/** Desired bbox line thickness in screen pixels — constant regardless of zoom. */
const BBOX_SCREEN_PX = 1;

type BboxPath = [number, number, number][];

interface UseBboxLayerOptions {
    viewport: Viewport | null;
    orthoCamera: OrthographicCamera | null;
    scale: { x: number; y: number };
}

interface UseBboxLayerReturn {
    updateBbox: (cx: number, cy: number, half: number, explicitBbox?: CellBbox) => void;
}

export function useBboxLayer({ viewport, orthoCamera, scale }: UseBboxLayerOptions): UseBboxLayerReturn {
    const bboxRef = useRef<Layer | null>(null);
    const bboxPathRef = useRef<BboxPath | null>(null);
    const drawBboxRef = useRef<(path: BboxPath) => void>(() => {});

    // ── Convert screen pixels to world-space width ─────────────────────
    const screenToWorldWidth = useCallback(
        (px: number) => {
            if (!viewport || !orthoCamera) return 0.005;
            const rect = orthoCamera.getWorldViewRect();
            const canvasWidth = viewport.element.clientWidth || 1;
            const worldWidth = rect.max[0] - rect.min[0];
            return px * (worldWidth / canvasWidth);
        },
        [viewport, orthoCamera],
    );

    // ── Draw/replace bbox layer ────────────────────────────────────────
    const drawBbox = useCallback(
        (path: BboxPath) => {
            if (!viewport) return;

            if (bboxRef.current) {
                viewport.layerManager.remove(bboxRef.current);
            }

            const width = screenToWorldWidth(BBOX_SCREEN_PX);
            const bbox = new ProjectedLineLayer([
                {
                    path,
                    color: [0.13, 0.83, 0.93],
                    width: Math.max(width, 0.001),
                },
            ]);

            viewport.layerManager.add(bbox);
            bboxRef.current = bbox;
        },
        [viewport, screenToWorldWidth],
    );

    // Keep ref in sync so the RAF callback always uses the latest version
    useEffect(() => {
        drawBboxRef.current = drawBbox;
    }, [drawBbox]);

    // ── Compute bbox path and draw ─────────────────────────────────────
    const updateBbox = useCallback(
        (cx: number, cy: number, half: number, explicitBbox?: CellBbox) => {
            let path: BboxPath;
            if (explicitBbox) {
                const { y_min, x_min, y_max, x_max } = explicitBbox;
                path = [
                    [x_min * scale.x, y_min * scale.y, 0],
                    [x_max * scale.x, y_min * scale.y, 0],
                    [x_max * scale.x, y_max * scale.y, 0],
                    [x_min * scale.x, y_max * scale.y, 0],
                    [x_min * scale.x, y_min * scale.y, 0],
                ];
            } else {
                const sx = cx * scale.x;
                const sy = cy * scale.y;
                const hx = half * scale.x;
                const hy = half * scale.y;
                path = [
                    [sx - hx, sy - hy, 0],
                    [sx + hx, sy - hy, 0],
                    [sx + hx, sy + hy, 0],
                    [sx - hx, sy + hy, 0],
                    [sx - hx, sy - hy, 0],
                ];
            }

            bboxPathRef.current = path;
            drawBbox(path);
        },
        [scale.x, scale.y, drawBbox],
    );

    // ── Redraw on zoom (wheel + pinch-to-zoom via pointerup) ───────────
    useEffect(() => {
        const el = viewport?.element;
        if (!el) return;
        const onZoom = () => {
            requestAnimationFrame(() => {
                const path = bboxPathRef.current;
                if (path) drawBboxRef.current(path);
            });
        };
        el.addEventListener("wheel", onZoom, { passive: true });
        el.addEventListener("pointerup", onZoom, { passive: true });
        return () => {
            el.removeEventListener("wheel", onZoom);
            el.removeEventListener("pointerup", onZoom);
        };
    }, [viewport]);

    // ── Cleanup on unmount — remove bbox from layer manager ────────────
    useEffect(() => {
        return () => {
            if (bboxRef.current && viewport) {
                viewport.layerManager.remove(bboxRef.current);
                bboxRef.current = null;
            }
            bboxPathRef.current = null;
        };
    }, [viewport]);

    return { updateBbox };
}
