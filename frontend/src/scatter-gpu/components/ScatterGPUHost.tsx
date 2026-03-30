/**
 * ScatterGPUHost — always-mounted WebGPU canvas host.
 *
 * This component owns the two canvas elements and the GPU handle lifecycle.
 * It NEVER conditionally unmounts based on loading state. Loading/error
 * overlays belong in the parent as position:absolute siblings.
 *
 * GPU initialization fires when BOTH:
 *   1. canvas is mounted (via callback ref), AND
 *   2. positions are available (positionKey changes)
 * whichever arrives last — eliminating the race condition where loading state
 * caused the canvas to unmount exactly when positions arrived.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { createScatterplot } from "../gpu/orchestrator";
import type { ScatterData, ScatterplotConfig, ScatterplotHandle } from "../types";
import type { ScatterGPUHostHandle } from "../handle-capabilities";

export type { ScatterGPUHostHandle } from "../handle-capabilities";

interface ScatterGPUHostProps {
  /** Current scatter data including positions and color indices. */
  data: ScatterData | null;
  /**
   * Stable string key: `${embeddingKey}:${numCells}`.
   * GPU re-initializes when this changes. Use instead of a Float32Array
   * reference equality check in a useEffect dep array.
   */
  positionKey: string | null;
  /**
   * Stable ScatterplotConfig — must be created with useRef in the parent
   * and never recreated, otherwise GPU re-inits on every render.
   */
  config: ScatterplotConfig;
  onGpuError(msg: string): void;
  onRowIndicesChange(indices: number[]): void;
}

export const ScatterGPUHost = forwardRef<ScatterGPUHostHandle, ScatterGPUHostProps>(function ScatterGPUHost(
  { data, positionKey, config, onGpuError, onRowIndicesChange },
  ref,
) {
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const overlayElRef = useRef<HTMLCanvasElement | null>(null);
  const gpuRef = useRef<ScatterplotHandle | null>(null);
  const initKeyRef = useRef<string | null>(null);

  // Refs to latest props — lets maybeInitGpu be stable (empty deps)
  // while always reading current values.
  const dataRef = useRef<ScatterData | null>(null);
  dataRef.current = data;
  const positionKeyRef = useRef<string | null>(null);
  positionKeyRef.current = positionKey;
  const onGpuErrorRef = useRef(onGpuError);
  onGpuErrorRef.current = onGpuError;
  const onRowIndicesChangeRef = useRef(onRowIndicesChange);
  onRowIndicesChangeRef.current = onRowIndicesChange;
  const configRef = useRef(config);
  configRef.current = config;

  /**
   * Attempt GPU initialization. Called from both the canvas callback ref
   * (fires on mount) and the positionKey effect (fires when data arrives).
   * Safe to call multiple times — skips if already initialized for the
   * current key or if prerequisites aren't met.
   */
  const maybeInitGpu = useCallback(() => {
    const canvas = canvasElRef.current;
    const overlay = overlayElRef.current;
    const currentData = dataRef.current;
    const currentKey = positionKeyRef.current;

    if (!canvas || !overlay || !currentData || !currentKey) return;
    if (initKeyRef.current === currentKey) return; // already initialized

    initKeyRef.current = currentKey;

    if (!navigator.gpu) {
      onGpuErrorRef.current("WebGPU not supported. Use Chrome, Edge, or Safari 18+.");
      return;
    }

    // Destroy previous GPU instance before re-initializing
    gpuRef.current?.destroy();
    gpuRef.current = null;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w > 0 && h > 0) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      overlay.width = Math.floor(w * dpr);
      overlay.height = Math.floor(h * dpr);
      const ctx = overlay.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
    }

    createScatterplot(canvas, overlay, currentData, configRef.current)
      .then((gpu) => {
        gpuRef.current = gpu;
        onRowIndicesChangeRef.current(currentData.rowIndices ?? []);
      })
      .catch((err: Error) => onGpuErrorRef.current(err.message));
  }, []); // stable — all reads through refs

  // Canvas callback refs — fire when the canvas element mounts/unmounts.
  // GPU init fires as soon as both canvases are in the DOM.
  const canvasCallbackRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      canvasElRef.current = el;
      if (el) maybeInitGpu();
    },
    [maybeInitGpu],
  );

  const overlayCallbackRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      overlayElRef.current = el;
      if (el) maybeInitGpu();
    },
    [maybeInitGpu],
  );

  // positionKey effect — fires when positions arrive or change.
  // Uses a string dep (safe) instead of Float32Array reference equality.
  useEffect(() => {
    if (!positionKey) {
      // No positions: reset so the next positionKey triggers re-init
      initKeyRef.current = null;
      gpuRef.current?.destroy();
      gpuRef.current = null;
      return;
    }
    maybeInitGpu();
  }, [positionKey, maybeInitGpu]);

  // ResizeObserver — keeps canvas pixel dimensions in sync with CSS size
  useEffect(() => {
    const canvas = canvasElRef.current;
    if (!canvas) return;

    const obs = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r || r.width === 0 || r.height === 0) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(r.width * dpr);
      canvas.height = Math.floor(r.height * dpr);
      const overlay = overlayElRef.current;
      if (overlay) {
        overlay.width = Math.floor(r.width * dpr);
        overlay.height = Math.floor(r.height * dpr);
        const ctx = overlay.getContext("2d");
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.scale(dpr, dpr);
        }
      }
      gpuRef.current?.resize(Math.floor(r.width), Math.floor(r.height));

      // If GPU wasn't initialized (clientWidth was 0 at mount), try now
      if (!initKeyRef.current) maybeInitGpu();
    });
    obs.observe(canvas);
    return () => obs.disconnect();
  }, [maybeInitGpu]);

  // Destroy GPU on unmount
  useEffect(() => {
    return () => {
      gpuRef.current?.destroy();
      gpuRef.current = null;
    };
  }, []);

  // Expose imperative handle to parent
  useImperativeHandle(
    ref,
    () => ({
      setColors(palette, indices) {
        gpuRef.current?.updateColors(palette, indices);
      },
      setColorsDirect(rgba) {
        gpuRef.current?.updateColorsDirect(rgba);
      },
      getViewState() {
        return gpuRef.current?.getViewState() ?? { panX: 0, panY: 0, zoom: 1 };
      },
      worldToScreen(wx, wy, w, h) {
        return gpuRef.current?.worldToScreen(wx, wy, w, h) ?? { x: 0, y: 0 };
      },
      setExternalSelection(params) {
        gpuRef.current?.setExternalSelection(params);
      },
      clearExternalSelection() {
        gpuRef.current?.clearExternalSelection();
      },
      setCategoryIsolation(isolatedSet: Set<number>, categoryIndices: Uint8Array) {
        gpuRef.current?.setCategoryIsolation(isolatedSet, categoryIndices);
      },
      clearCategoryIsolation() {
        gpuRef.current?.clearCategoryIsolation();
      },
      setRowIsolation(rowIndices: number[]) {
        gpuRef.current?.setRowIsolation(rowIndices);
      },
      clearRowIsolation() {
        gpuRef.current?.clearRowIsolation();
      },
      setViewState(state) {
        gpuRef.current?.setViewState(state);
      },
      setForcedSelectionMode(mode) {
        gpuRef.current?.setForcedSelectionMode(mode);
      },
    }),
    [],
  );

  return (
    <div className="absolute inset-0" style={{ backgroundColor: "var(--color-base)" }}>
      <canvas ref={canvasCallbackRef} className="absolute inset-0 w-full h-full" style={{ display: "block" }} />
      <canvas
        ref={overlayCallbackRef}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
        style={{ display: "block" }}
      />
    </div>
  );
});
