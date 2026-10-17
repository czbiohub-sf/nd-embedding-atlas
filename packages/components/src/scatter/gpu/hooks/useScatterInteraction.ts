import type { PanZoomView, TurntableView, ViewSyncState } from "@ndea/sdk";
import type { Camera } from "../../gpu/gpu/camera";
import type { PaintShape } from "../../gpu/gpu/selection";
import type { InteractionConfig } from "../../gpu/types";

interface InteractionCallbacks {
  onViewChange?: (state: PanZoomView | TurntableView) => void;
  /** Click hit test at CSS pixels relative to the overlay. */
  onPointClick?: (pixelX: number, pixelY: number) => void;
  onFps?: (fps: number) => void;
  /** Lasso/marquee: paint the shape (overlay CSS px) into the selection mask. */
  onSelect: (paint: PaintShape, final: boolean) => void;
}

function getOverlayColors() {
  const isDark = document.documentElement.classList.contains("dark");
  return {
    stroke: isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(30, 30, 30, 0.75)",
    fill: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)",
  };
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function tracePath(ctx: Ctx2D, path: readonly [number, number][]) {
  ctx.beginPath();
  for (const [x, y] of path) ctx.lineTo(x, y);
  ctx.closePath();
}

/** Right-drag pans the 3D view, so the overlay has no context menu. */
function noMenu(e: MouseEvent) {
  e.preventDefault();
}

/**
 * Pointer/wheel input and the render-on-demand loop. Selection shapes stay in
 * overlay CSS pixels: the GPU tests each point's projection against them.
 * Drag pans in 2D and orbits in 3D; in 3D a right/middle or Ctrl/Cmd drag pans.
 */
export function createInteractionController(
  overlay: HTMLCanvasElement,
  camera: Camera,
  renderFn: () => void,
  callbacks: InteractionCallbacks,
  interactionConfig?: InteractionConfig,
) {
  const enablePan = interactionConfig?.pan ?? true;
  const enableZoom = interactionConfig?.zoom ?? true;
  const enableLasso = interactionConfig?.lasso ?? true;
  const enableMarquee = interactionConfig?.marquee ?? true;

  // Toolbar mode: 'pan' = drag pans; 'marquee'/'lasso' = drag selects without modifiers.
  let forcedSelectionMode: "pan" | "marquee" | "lasso" = "pan";
  // The overlay is DPR-scaled by its owner (ctx.scale(dpr, dpr)), so drawing uses CSS px.
  const overlayCtx = overlay.getContext("2d")!;

  // Suppress the next onViewChange broadcast (setViewState from view sync).
  let skipNextViewChange = false;
  let isDragging = false;
  let dragPans = false;
  let isLassoing = false;
  let isMarquee = false;
  let lastMouse: [number, number] = [0, 0];
  let pointerDownPos: [number, number] = [0, 0];
  let needsRender = true;
  let lassoPath: [number, number][] = [];
  let marqueeStart: [number, number] = [0, 0];
  let marqueeEnd: [number, number] = [0, 0];
  let lastSelectionCompute = 0; // throttles drag dispatches to ~8 ms

  const toNdc = (px: number, py: number): [number, number] => [
    (px / overlay.clientWidth) * 2 - 1,
    1 - (py / overlay.clientHeight) * 2,
  ];

  function viewChanged() {
    needsRender = true;
    scheduleLoop();
    if (!skipNextViewChange) callbacks.onViewChange?.(camera.toViewState());
    skipNextViewChange = false;
  }

  function marqueeRect() {
    const x = Math.min(marqueeStart[0], marqueeEnd[0]);
    const y = Math.min(marqueeStart[1], marqueeEnd[1]);
    return [x, y, Math.abs(marqueeEnd[0] - marqueeStart[0]), Math.abs(marqueeEnd[1] - marqueeStart[1])] as const;
  }

  function drawShape() {
    overlayCtx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
    const { stroke, fill } = getOverlayColors();
    overlayCtx.strokeStyle = stroke;
    overlayCtx.fillStyle = fill;
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([6, 4]);
    if (isLassoing && lassoPath.length >= 2) {
      tracePath(overlayCtx, lassoPath);
      overlayCtx.stroke();
      overlayCtx.fill();
    } else if (isMarquee) {
      const [x, y, w, h] = marqueeRect();
      if (w < 2 && h < 2) return;
      overlayCtx.strokeRect(x, y, w, h);
      overlayCtx.fillRect(x, y, w, h);
    }
  }

  /** Paint the current shape for the selection mask, or null if it is too small. */
  function currentShape(): PaintShape | null {
    if (isLassoing) {
      if (lassoPath.length < 3) return null;
      const path = lassoPath;
      return (ctx) => {
        tracePath(ctx, path);
        ctx.fill();
      };
    }
    const [x, y, w, h] = marqueeRect();
    if (w < 2 && h < 2) return null;
    return (ctx) => ctx.fillRect(x, y, w, h);
  }

  function select(final: boolean) {
    const now = performance.now();
    if (!final && now - lastSelectionCompute <= 8) return;
    lastSelectionCompute = now;
    const paint = currentShape();
    if (!paint) return;
    callbacks.onSelect(paint, final);
    needsRender = true;
    scheduleLoop();
  }

  function onPointerDown(e: PointerEvent) {
    // Lasso: Shift+Alt+drag or lasso mode. Marquee: Shift+drag or marquee mode.
    const wantsLasso = (e.shiftKey && e.altKey) || forcedSelectionMode === "lasso";
    const wantsMarquee = (e.shiftKey && !e.altKey) || forcedSelectionMode === "marquee";
    const p: [number, number] = [e.offsetX, e.offsetY];
    if (wantsLasso && enableLasso) {
      isLassoing = true;
      lassoPath = [p];
    } else if (wantsMarquee && enableMarquee) {
      isMarquee = true;
      marqueeStart = marqueeEnd = p;
    } else if (enablePan) {
      isDragging = true;
      dragPans = e.button !== 0 || e.ctrlKey || e.metaKey;
      if (camera.settle()) viewChanged();
      lastMouse = pointerDownPos = p;
    } else return;
    overlay.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    const p: [number, number] = [e.offsetX, e.offsetY];
    if (isLassoing) {
      lassoPath.push(p);
      drawShape();
      select(false);
    } else if (isMarquee) {
      marqueeEnd = p;
      drawShape();
      select(false);
    } else if (isDragging) {
      camera.drag(toNdc(...lastMouse), toNdc(...p), overlay.clientWidth / overlay.clientHeight || 1, dragPans);
      lastMouse = p;
      viewChanged();
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (isLassoing || isMarquee) {
      overlayCtx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
      select(true);
      isLassoing = isMarquee = false;
      lassoPath = [];
    } else if (isDragging) {
      isDragging = false;
      const dx = e.offsetX - pointerDownPos[0];
      const dy = e.offsetY - pointerDownPos[1];
      if (dx * dx + dy * dy < 25 && !dragPans && callbacks.onPointClick) {
        callbacks.onPointClick(e.offsetX, e.offsetY);
        needsRender = true;
        scheduleLoop();
      }
    } else return;
    overlay.releasePointerCapture(e.pointerId);
  }

  function onWheel(e: WheelEvent) {
    if (!enableZoom) return;
    e.preventDefault();
    // Exponential zoom: trackpads give small deltaY (~1-10), wheels ~100.
    camera.zoomAt(
      ...toNdc(e.offsetX, e.offsetY),
      overlay.clientWidth / overlay.clientHeight || 1,
      Math.exp(-e.deltaY / 200),
    );
    scheduleLoop();
  }

  overlay.addEventListener("pointerdown", onPointerDown);
  overlay.addEventListener("pointermove", onPointerMove);
  overlay.addEventListener("pointerup", onPointerUp);
  overlay.addEventListener("wheel", onWheel, { passive: false });
  overlay.addEventListener("contextmenu", noMenu);

  const frameTimes = new Float64Array(120);
  let frameIdx = 0;
  let lastFpsReport = 0;

  // Render loop: runs only while easing or when a render is pending.
  let animId = 0;
  let loopRunning = false;

  function scheduleLoop() {
    if (!loopRunning) {
      loopRunning = true;
      animId = requestAnimationFrame(loop);
    }
  }

  function loop() {
    loopRunning = false;
    if (camera.step(performance.now())) viewChanged();
    if (needsRender) {
      renderFn();
      needsRender = false;
      const now = performance.now();
      frameTimes[frameIdx % 120] = now;
      frameIdx++;
      if (now - lastFpsReport > 500) {
        lastFpsReport = now;
        const n = Math.min(frameIdx, 120);
        if (n > 1) callbacks.onFps?.((n - 1) / ((now - frameTimes[(frameIdx - n) % 120]) / 1000));
      }
    }
    if (camera.animating) scheduleLoop();
  }

  viewChanged();

  return {
    requestRender() {
      needsRender = true;
      scheduleLoop();
    },
    /** Apply a synced view; ignored (no render, no broadcast) when it is the other dimensionality's. */
    setViewState(state: ViewSyncState) {
      if (!camera.set(state)) return;
      skipNextViewChange = true;
      viewChanged();
    },
    setForcedSelectionMode(mode: "pan" | "marquee" | "lasso") {
      forcedSelectionMode = mode;
    },
    /** The camera or canvas changed outside pointer input: re-render and broadcast. */
    viewChanged,
    destroy() {
      cancelAnimationFrame(animId);
      overlay.removeEventListener("pointerdown", onPointerDown);
      overlay.removeEventListener("pointermove", onPointerMove);
      overlay.removeEventListener("pointerup", onPointerUp);
      overlay.removeEventListener("wheel", onWheel);
      overlay.removeEventListener("contextmenu", noMenu);
    },
  };
}
