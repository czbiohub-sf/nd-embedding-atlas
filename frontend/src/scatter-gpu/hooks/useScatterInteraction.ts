import * as d from "typegpu/data";
import type { ScatterUniforms } from "../gpu/buffers";
import type { SelectionEngine } from "../gpu/selection";
import type { InteractionConfig } from "../types";
import type { ViewState } from "../../types";

interface InteractionCallbacks {
  onViewChange?: (state: ViewState) => void;
  onPointClick?: (worldX: number, worldY: number) => void;
  onFps?: (fps: number) => void;
}

export function createInteractionController(
  _canvas: HTMLCanvasElement,
  overlay: HTMLCanvasElement,
  uniforms: ScatterUniforms,
  selection: SelectionEngine,
  renderFn: () => void,
  callbacks?: InteractionCallbacks,
  interactionConfig?: InteractionConfig,
) {
  const LERP_SPEED = interactionConfig?.lerpSpeed ?? 0.06;
  const LERP_EPSILON = interactionConfig?.lerpEpsilon ?? 0.0001;

  const MIN_ZOOM = interactionConfig?.minZoom ?? 0.1;
  const MAX_ZOOM = interactionConfig?.maxZoom ?? 500;
  const enablePan = interactionConfig?.pan ?? true;
  const enableZoom = interactionConfig?.zoom ?? true;
  const enableLasso = interactionConfig?.lasso ?? true;
  const enableMarquee = interactionConfig?.marquee ?? true;

  // Forced selection mode — set by toolbar buttons; bypasses keyboard modifiers.
  // 'pan' = default drag-to-pan; 'marquee'/'lasso' = drag-to-select without Shift.
  let forcedSelectionMode: "pan" | "marquee" | "lasso" = "pan";
  // NOTE: The overlay canvas must be DPR-scaled before passing to this controller.
  // Apply: overlay.width = Math.floor(cssW * dpr); overlay.height = Math.floor(cssH * dpr);
  // Then: const ctx = overlay.getContext("2d"); ctx.scale(dpr, dpr);
  // This ensures lasso/marquee drawing is crisp on retina displays.
  const overlayCtx = overlay.getContext("2d")!;

  // Current (rendered) values — what the GPU sees
  let panX = 0;
  let panY = 0;
  let zoom = 1;

  // Target values — what we're easing toward
  let targetPanX = 0;
  let targetPanY = 0;
  let targetZoom = 1;

  // Suppress the next onViewChange broadcast (used by setViewState to avoid feedback loops)
  let skipNextViewChange = false;

  let isPanning = false;
  let isLassoing = false;
  let isMarquee = false;
  let isAnimating = false;
  let lastMouse = { x: 0, y: 0 };
  let pointerDownPos = { x: 0, y: 0 };
  let needsRender = true;
  let lassoPath: [number, number][] = [];
  let marqueeStart: [number, number] = [0, 0];
  let marqueeEnd: [number, number] = [0, 0];
  let lastSelectionDispatch = 0; // governs readback  (~50 ms / 20 fps)
  let lastSelectionCompute = 0; // governs compute dispatch (~8 ms / 120 fps)

  function updateView() {
    const aspect = overlay.clientWidth / overlay.clientHeight || 1;
    uniforms.viewUniform.write(d.vec4f(panX, panY, zoom, aspect));
    needsRender = true;
    scheduleLoop();
    if (!skipNextViewChange) {
      callbacks?.onViewChange?.({ panX, panY, zoom });
    }
    skipNextViewChange = false;
  }

  function snapToTarget() {
    panX = targetPanX;
    panY = targetPanY;
    zoom = targetZoom;
    isAnimating = false;
    updateView();
  }

  function startAnimation() {
    isAnimating = true;
    scheduleLoop();
  }

  // Use overlay CSS dimensions for all coordinate math since
  // pointer events report CSS pixels, not device pixels.
  function pixelToWorld(px: number, py: number): [number, number] {
    const w = overlay.clientWidth;
    const h = overlay.clientHeight;
    const aspect = w / h || 1;
    const ndcX = (px / w) * 2 - 1;
    const ndcY = -((py / h) * 2 - 1);
    return [(ndcX * aspect) / zoom - panX, ndcY / zoom - panY];
  }

  function pixelToNDC(px: number, py: number): [number, number] {
    const w = overlay.clientWidth;
    const h = overlay.clientHeight;
    return [(px / w) * 2 - 1, -((py / h) * 2 - 1)];
  }

  function worldToPixel(wx: number, wy: number): [number, number] {
    const aspect = overlay.clientWidth / overlay.clientHeight || 1;
    const ndcX = ((wx + panX) * zoom) / aspect;
    const ndcY = (wy + panY) * zoom;
    // Use clientWidth/clientHeight (CSS pixels) — the 2D context has ctx.scale(dpr,dpr)
    // so drawing ops expect CSS-pixel coordinates, not device pixels.
    return [((ndcX + 1) / 2) * overlay.clientWidth, ((-ndcY + 1) / 2) * overlay.clientHeight];
  }

  function drawLasso() {
    overlayCtx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
    if (lassoPath.length < 2) return;

    overlayCtx.beginPath();
    for (let i = 0; i < lassoPath.length; i++) {
      const [wx, wy] = lassoPath[i];
      const [px, py] = worldToPixel(wx, wy);
      if (i === 0) overlayCtx.moveTo(px, py);
      else overlayCtx.lineTo(px, py);
    }
    overlayCtx.closePath();
    overlayCtx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([6, 4]);
    overlayCtx.stroke();
    overlayCtx.fillStyle = "rgba(255, 255, 255, 0.05)";
    overlayCtx.fill();
  }

  function drawMarquee() {
    overlayCtx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
    const [x1, y1] = worldToPixel(marqueeStart[0], marqueeStart[1]);
    const [x2, y2] = worldToPixel(marqueeEnd[0], marqueeEnd[1]);
    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    if (rw < 2 && rh < 2) return;

    overlayCtx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([6, 4]);
    overlayCtx.strokeRect(rx, ry, rw, rh);
    overlayCtx.fillStyle = "rgba(255, 255, 255, 0.05)";
    overlayCtx.fillRect(rx, ry, rw, rh);
  }

  // Named handlers for proper cleanup
  function onPointerDown(e: PointerEvent) {
    // Lasso: Shift+Alt+drag (keyboard) or forced lasso mode (button)
    // Marquee: Shift+drag (keyboard) or forced marquee mode (button)
    const wantsLasso = (e.shiftKey && e.altKey) || forcedSelectionMode === "lasso";
    const wantsMarquee = (e.shiftKey && !e.altKey) || forcedSelectionMode === "marquee";

    if (wantsLasso && enableLasso) {
      isLassoing = true;
      lassoPath = [pixelToWorld(e.offsetX, e.offsetY)];
      overlay.setPointerCapture(e.pointerId);
    } else if (wantsMarquee && enableMarquee) {
      isMarquee = true;
      marqueeStart = pixelToWorld(e.offsetX, e.offsetY);
      marqueeEnd = marqueeStart;
      overlay.setPointerCapture(e.pointerId);
    } else if (enablePan) {
      isPanning = true;
      snapToTarget();
      lastMouse = { x: e.offsetX, y: e.offsetY };
      pointerDownPos = { x: e.offsetX, y: e.offsetY };
      overlay.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (isLassoing) {
      lassoPath.push(pixelToWorld(e.offsetX, e.offsetY));
      drawLasso();
      if (lassoPath.length >= 3) {
        const now = performance.now();
        const doCompute = now - lastSelectionCompute > 8; // ~120 fps cap
        const doReadback = now - lastSelectionDispatch > 50; // ~20 fps readback
        if (doCompute) {
          lastSelectionCompute = now;
          if (doReadback) lastSelectionDispatch = now;
          selection.runLassoSelection(lassoPath, doReadback);
          needsRender = true;
          scheduleLoop();
        }
      }
    } else if (isMarquee) {
      marqueeEnd = pixelToWorld(e.offsetX, e.offsetY);
      drawMarquee();
      const xMin = Math.min(marqueeStart[0], marqueeEnd[0]);
      const xMax = Math.max(marqueeStart[0], marqueeEnd[0]);
      const yMin = Math.min(marqueeStart[1], marqueeEnd[1]);
      const yMax = Math.max(marqueeStart[1], marqueeEnd[1]);
      if (xMax - xMin > 0.001 || yMax - yMin > 0.001) {
        const now = performance.now();
        const doCompute = now - lastSelectionCompute > 8;
        const doReadback = now - lastSelectionDispatch > 50;
        if (doCompute) {
          lastSelectionCompute = now;
          if (doReadback) lastSelectionDispatch = now;
          selection.runMarqueeSelection({ xMin, yMin, xMax, yMax }, doReadback);
          needsRender = true;
          scheduleLoop();
        }
      }
    } else if (isPanning) {
      const aspect = overlay.clientWidth / overlay.clientHeight || 1;
      const dx = (((e.offsetX - lastMouse.x) / overlay.clientWidth) * 2 * aspect) / zoom;
      const dy = (-((e.offsetY - lastMouse.y) / overlay.clientHeight) * 2) / zoom;
      panX += dx;
      panY += dy;
      targetPanX = panX;
      targetPanY = panY;
      lastMouse = { x: e.offsetX, y: e.offsetY };
      updateView();
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (isLassoing) {
      isLassoing = false;
      overlayCtx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
      if (lassoPath.length >= 3) {
        selection.runLassoSelection(lassoPath);
        needsRender = true;
        scheduleLoop();
      }
      lassoPath = [];
      overlay.releasePointerCapture(e.pointerId);
    } else if (isMarquee) {
      isMarquee = false;
      overlayCtx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
      const xMin = Math.min(marqueeStart[0], marqueeEnd[0]);
      const xMax = Math.max(marqueeStart[0], marqueeEnd[0]);
      const yMin = Math.min(marqueeStart[1], marqueeEnd[1]);
      const yMax = Math.max(marqueeStart[1], marqueeEnd[1]);
      if (xMax - xMin > 0.001 || yMax - yMin > 0.001) {
        selection.runMarqueeSelection({ xMin, yMin, xMax, yMax });
        needsRender = true;
        scheduleLoop();
      }
      overlay.releasePointerCapture(e.pointerId);
    } else if (isPanning) {
      isPanning = false;
      const dx = e.offsetX - pointerDownPos.x;
      const dy = e.offsetY - pointerDownPos.y;
      if (dx * dx + dy * dy < 25 && callbacks?.onPointClick) {
        const [wx, wy] = pixelToWorld(e.offsetX, e.offsetY);
        callbacks.onPointClick(wx, wy);
        needsRender = true;
        scheduleLoop();
      }
      overlay.releasePointerCapture(e.pointerId);
    }
  }

  function onDblClick() {
    const t0 = performance.now();
    lastSelectionDispatch = 0;
    lastSelectionCompute = 0;
    selection.clearSelection();
    needsRender = true;
    scheduleLoop();
    console.log(`Deselection: ${(performance.now() - t0).toFixed(1)}ms`);
  }

  function onWheel(e: WheelEvent) {
    if (!enableZoom) return;
    e.preventDefault();
    const [mx, my] = pixelToNDC(e.offsetX, e.offsetY);
    const aspect = overlay.clientWidth / overlay.clientHeight || 1;

    // Compute world point under cursor using current target (not lerped) values
    const worldX = (mx * aspect) / targetZoom - targetPanX;
    const worldY = my / targetZoom - targetPanY;

    // Exponential zoom: smooth, proportional to scroll magnitude.
    // Trackpad gives small deltaY (~1-10), mouse wheel gives larger (~100).
    const zoomFactor = Math.exp(-e.deltaY / 200);
    targetZoom *= zoomFactor;
    targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));

    // Magnetic snap: gentle detent at "home" zoom where embedding fills ~80% of canvas.
    // Data is normalized to [-0.9, 0.9], so zoom ~0.9 frames it with margin.
    const SNAP_ZOOM = 0.9;
    const SNAP_RANGE = 0.12; // ±12% of snap zoom triggers attraction
    const SNAP_STRENGTH = 0.3; // 0 = no snap, 1 = hard snap
    const dist = Math.abs(targetZoom - SNAP_ZOOM);
    if (dist < SNAP_RANGE * SNAP_ZOOM) {
      const pull = (1 - dist / (SNAP_RANGE * SNAP_ZOOM)) * SNAP_STRENGTH;
      targetZoom += (SNAP_ZOOM - targetZoom) * pull;
    }

    // Adjust pan so the world point stays under the cursor
    targetPanX = (mx * aspect) / targetZoom - worldX;
    targetPanY = my / targetZoom - worldY;

    startAnimation();
  }

  // Attach event listeners
  overlay.addEventListener("pointerdown", onPointerDown);
  overlay.addEventListener("pointermove", onPointerMove);
  overlay.addEventListener("pointerup", onPointerUp);
  overlay.addEventListener("dblclick", onDblClick);
  overlay.addEventListener("wheel", onWheel, { passive: false });

  // Frame time tracking
  const frameTimes = new Float64Array(120);
  let frameIdx = 0;
  let lastFpsReport = 0;

  // Render loop — only runs when there's work (animation or pending render)
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

    if (isAnimating) {
      // Lerp toward target
      panX += (targetPanX - panX) * LERP_SPEED;
      panY += (targetPanY - panY) * LERP_SPEED;
      zoom += (targetZoom - zoom) * LERP_SPEED;

      // Check if close enough to snap
      const dz = Math.abs(targetZoom - zoom) / Math.max(targetZoom, 0.01);
      const dp = Math.abs(targetPanX - panX) + Math.abs(targetPanY - panY);
      if (dz < LERP_EPSILON && dp < LERP_EPSILON) {
        snapToTarget();
      } else {
        updateView();
      }
    }
    if (needsRender) {
      renderFn();
      needsRender = false;
      const now = performance.now();
      frameTimes[frameIdx % 120] = now;
      frameIdx++;
      if (now - lastFpsReport > 500) {
        lastFpsReport = now;
        const n = Math.min(frameIdx, 120);
        if (n > 1) {
          const oldest = frameTimes[(frameIdx - n) % 120]!;
          const fps = (n - 1) / ((now - oldest) / 1000);
          callbacks?.onFps?.(fps);
        }
      }
    }
    // Keep looping only if still animating
    if (isAnimating) {
      scheduleLoop();
    }
  }

  updateView();

  return {
    requestRender() {
      needsRender = true;
      scheduleLoop();
    },
    getViewState(): ViewState {
      return { panX, panY, zoom };
    },
    setViewState(state: ViewState) {
      panX = targetPanX = state.panX;
      panY = targetPanY = state.panY;
      zoom = targetZoom = state.zoom;
      skipNextViewChange = true;
      updateView();
    },
    setForcedSelectionMode(mode: "pan" | "marquee" | "lasso") {
      forcedSelectionMode = mode;
    },
    resize() {
      updateView();
    },
    destroy() {
      cancelAnimationFrame(animId);
      overlay.removeEventListener("pointerdown", onPointerDown);
      overlay.removeEventListener("pointermove", onPointerMove);
      overlay.removeEventListener("pointerup", onPointerUp);
      overlay.removeEventListener("dblclick", onDblClick);
      overlay.removeEventListener("wheel", onWheel);
    },
  };
}
