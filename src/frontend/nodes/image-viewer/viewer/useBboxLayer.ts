import type { Idetik, Overlay } from "@idetik/core";
import { mat4, vec4 } from "gl-matrix";
import { useCallback, useEffect, useRef } from "react";
import type { ObsBbox } from "@/types";

interface UseBboxLayerOptions {
  /** The Idetik runtime — pulled from useViewer().meta.runtime. */
  idetik: Idetik | null;
  scale: { x: number; y: number };
  /**
   * World-space offset of the FOV image origin. Mirrors the camera-frame
   * adjustment in SingleCropViewer — without it the bbox is drawn at
   * `(obs * scale)` while idetik renders the underlying image at
   * `(obs * scale + translation)`, leaving the box stranded near (0,0).
   */
  translation?: { x: number; y: number } | null;
}

interface UseBboxLayerReturn {
  updateBbox: (cx: number, cy: number, half: number, explicitBbox?: ObsBbox) => void;
  /** Hide the box (no bbox / no centroid, or the user toggled it off). */
  clearBbox: () => void;
}

// Themed via the destructive token (red across light/dark) instead of a
// hard-coded rgb — tracks the palette like every other chrome color.
const BBOX_COLOR = "var(--destructive)";
const BBOX_BORDER_PX = 2;

/**
 * Draws a bounding box around the active observation as an HTML overlay.
 *
 * Why HTML and not an idetik layer? @idetik/core@0.19.0 removed
 * `ProjectedLineLayer` and no public replacement exists (upstream
 * chanzuckerberg/idetik#90 tracks adding a simple line renderable). The
 * remaining options were vendoring internal `ProjectedLine` +
 * `ProjectedLineGeometry` (fragile, depends on minified internals) or
 * drawing the bbox in DOM. DOM wins: zero GPU resources for a 4-edge
 * rectangle, decoupled from idetik's render graph, and visually identical.
 *
 * The bbox <div> is repositioned every frame via idetik's public `Overlay`
 * API (`idetik.overlays.push({ update(i) {...} })`). World-space corners
 * are projected through `camera.projectionMatrix * camera.viewMatrix` and
 * mapped to client pixels.
 */
export function useBboxLayer({ idetik, scale, translation }: UseBboxLayerOptions): UseBboxLayerReturn {
  // World-space corners of the bbox. Empty = hidden.
  const cornersRef = useRef<[number, number][]>([]);
  const divRef = useRef<HTMLDivElement | null>(null);
  const tx = translation?.x ?? 0;
  const ty = translation?.y ?? 0;

  // Mount overlay + div for the active idetik instance. Re-runs on mode
  // switch (ViewerProvider recreates the runtime).
  useEffect(() => {
    if (!idetik) return;
    const parent = idetik.canvas.parentElement;
    if (!parent) return;

    // Reset stale corners from a previous runtime instance.
    cornersRef.current = [];

    const div = document.createElement("div");
    div.style.position = "absolute";
    div.style.pointerEvents = "none";
    div.style.border = `${BBOX_BORDER_PX}px solid ${BBOX_COLOR}`;
    div.style.boxSizing = "border-box";
    div.style.display = "none";
    div.style.zIndex = "10";
    parent.appendChild(div);
    divRef.current = div;

    const vpMatrix = mat4.create();
    const worldVec = vec4.create();
    const clipVec = vec4.create();

    const overlay: Overlay = {
      update(i: Idetik) {
        const corners = cornersRef.current;
        const el = divRef.current;
        if (!el) return;
        if (corners.length === 0) {
          if (el.style.display !== "none") el.style.display = "none";
          return;
        }

        const viewport = i.viewports[0];
        if (!viewport) return;
        const camera = viewport.camera;

        mat4.multiply(vpMatrix, camera.projectionMatrix, camera.viewMatrix);

        const canvas = i.canvas;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (w === 0 || h === 0) return;

        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (const [wx, wy] of corners) {
          vec4.set(worldVec, wx, wy, 0, 1);
          vec4.transformMat4(clipVec, worldVec, vpMatrix);
          // Bail if any corner is behind the camera (perspective only).
          if (clipVec[3] <= 0) return;
          const ndcX = clipVec[0] / clipVec[3];
          // idetik's WebGL renderer premultiplies the projection by a Y-flip
          // (`Ei = mat4.fromScaling([1,-1,1])` → `Projection = Ei · projectionMatrix`)
          // so image rows render top-down. We project through the bare
          // `projectionMatrix`, so we must apply the same flip here or the box
          // mirrors the image about the viewport center — invisible when the
          // feature is centered, drifting ∝ off-center distance under pan/zoom.
          const ndcY = -clipVec[1] / clipVec[3];
          const cx = (ndcX + 1) * 0.5 * w;
          const cy = (1 - ndcY) * 0.5 * h;
          if (cx < minX) minX = cx;
          if (cy < minY) minY = cy;
          if (cx > maxX) maxX = cx;
          if (cy > maxY) maxY = cy;
        }

        const canvasRect = canvas.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const offsetX = canvasRect.left - parentRect.left;
        const offsetY = canvasRect.top - parentRect.top;

        el.style.left = `${offsetX + minX}px`;
        el.style.top = `${offsetY + minY}px`;
        el.style.width = `${maxX - minX}px`;
        el.style.height = `${maxY - minY}px`;
        if (el.style.display !== "block") el.style.display = "block";
      },
    };

    idetik.overlays.push(overlay);

    return () => {
      const idx = idetik.overlays.indexOf(overlay);
      if (idx >= 0) idetik.overlays.splice(idx, 1);
      div.remove();
      divRef.current = null;
    };
  }, [idetik]);

  const updateBbox = useCallback(
    (cx: number, cy: number, half: number, explicitBbox?: ObsBbox) => {
      let corners: [number, number][];
      if (explicitBbox) {
        const { y_min, x_min, y_max, x_max } = explicitBbox;
        corners = [
          [x_min * scale.x + tx, y_min * scale.y + ty],
          [x_max * scale.x + tx, y_min * scale.y + ty],
          [x_max * scale.x + tx, y_max * scale.y + ty],
          [x_min * scale.x + tx, y_max * scale.y + ty],
        ];
      } else {
        const sx = cx * scale.x + tx;
        const sy = cy * scale.y + ty;
        const hx = half * scale.x;
        const hy = half * scale.y;
        corners = [
          [sx - hx, sy - hy],
          [sx + hx, sy - hy],
          [sx + hx, sy + hy],
          [sx - hx, sy + hy],
        ];
      }
      cornersRef.current = corners;
    },
    [scale.x, scale.y, tx, ty],
  );

  const clearBbox = useCallback(() => {
    cornersRef.current = [];
  }, []);

  return { updateBbox, clearBbox };
}
