import { type Layer, ProjectedLineLayer, type Viewport } from "@idetik/core";
import { useCallback, useEffect, useRef } from "react";
import type { ObsBbox } from "../../types";

type BboxPath = [number, number, number][];

interface UseBboxLayerOptions {
  viewport: Viewport | null;
  scale: { x: number; y: number };
}

interface UseBboxLayerReturn {
  updateBbox: (cx: number, cy: number, half: number, explicitBbox?: ObsBbox) => void;
}

/**
 * Line width in NDC (normalized device coordinates).
 * ProjectedLineLayer applies width in screen space after projection,
 * so this value is zoom-independent. 0.01 ≈ 1% of screen width.
 */
const LINE_WIDTH_NDC = 0.01;

export function useBboxLayer({ viewport, scale }: UseBboxLayerOptions): UseBboxLayerReturn {
  const bboxRef = useRef<Layer | null>(null);

  const updateBbox = useCallback(
    (cx: number, cy: number, half: number, explicitBbox?: ObsBbox) => {
      if (!viewport) return;

      if (bboxRef.current) {
        viewport.layerManager.remove(bboxRef.current);
        bboxRef.current = null;
      }

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

      // Draw 4 separate edges to avoid corner overlap artifacts
      const [a, b, c, d] = path;
      const color: [number, number, number] = [0.8, 0.1, 0.1];
      const bbox = new ProjectedLineLayer([
        { path: [a, b], color, width: LINE_WIDTH_NDC },
        { path: [b, c], color, width: LINE_WIDTH_NDC },
        { path: [c, d], color, width: LINE_WIDTH_NDC },
        { path: [d, a], color, width: LINE_WIDTH_NDC },
      ]);
      // Mark as transparent so idetik renders it AFTER opaque image layers
      bbox.transparent = true;

      viewport.layerManager.add(bbox);
      bboxRef.current = bbox;
    },
    [viewport, scale.x, scale.y],
  );

  useEffect(() => {
    return () => {
      if (bboxRef.current && viewport) {
        viewport.layerManager.remove(bboxRef.current);
      }
      bboxRef.current = null;
    };
  }, [viewport]);

  return { updateBbox };
}
