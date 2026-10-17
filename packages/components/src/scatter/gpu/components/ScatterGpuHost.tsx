/**
 * ScatterGPUHost: always-mounted WebGPU canvas host.
 *
 * This component owns the two canvas elements and the GPU handle lifecycle.
 * It NEVER conditionally unmounts based on loading state. Loading/error
 * overlays belong in the parent as position:absolute siblings.
 *
 * GPU initialization fires when BOTH:
 *   1. canvas is mounted (via callback ref), AND
 *   2. positions are available (positionKey changes)
 * whichever arrives last: eliminating the race condition where loading state
 * caused the canvas to unmount exactly when positions arrived.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { RowIndex } from "@ndea/sdk";
import { useScatterDeviceLease, useScatterServices } from "../../context";
import { createScatterplot } from "../../gpu/gpu/orchestrator";
import type { ScatterGPUHostHandle } from "../../gpu/handle-capabilities";
import type { ScatterData, ScatterplotConfig, ScatterplotHandle } from "../../gpu/types";

export type { ScatterGPUHostHandle } from "../../gpu/handle-capabilities";

/**
 * Declarative point-style contract. Applied on change AND re-applied on GPU
 * reinit: replaces the imperative setPointRadius/Opacity/BlendMode/HdrSettings
 * pokes + store subscriptions that ScatterView used to maintain. First slice of
 * the prop-driven `<ScatterCanvas>` contract (these are human-cadence, not the
 * 60fps camera path, so a declarative prop is safe here).
 */
export interface ScatterPointStyle {
  radius: number;
  opacity: number;
  blendMode: "additive" | "premultiplied" | "max";
  toneMapping: "none" | "reinhard" | "aces" | "agx" | "neutral";
  exposure: number;
}

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
   * Stable ScatterplotConfig: must be created with useRef in the parent
   * and never recreated, otherwise GPU re-inits on every render.
   */
  config: ScatterplotConfig;
  onGpuError(msg: string): void;
  /** A new GPU instance is live (first init or reinit): re-apply imperative state. */
  onReady(numPoints: number): void;
  /** Declarative point style: applied on change, re-applied on GPU reinit. */
  pointStyle?: ScatterPointStyle;
  /** Declarative full-bright highlight set (e.g. trajectory points). null/empty = none. */
  highlightRowIds?: readonly RowIndex[] | null;
  /** Filter-scope predicate row bitmask. null = inactive; empty = hide every point. */
  predicateBits?: Uint32Array | null;
}

/** Push a point style onto a live GPU handle (no-op if either is absent). */
function applyPointStyle(gpu: ScatterplotHandle | null, style: ScatterPointStyle | undefined): void {
  if (!gpu || !style) return;
  gpu.setPointRadius(style.radius);
  gpu.setPointOpacity(style.opacity);
  gpu.setBlendMode(style.blendMode);
  gpu.setHdrSettings({ toneMapping: style.toneMapping, exposure: style.exposure });
}

/** Push the highlight set onto a live GPU handle (null/empty → clear). */
function applyHighlight(gpu: ScatterplotHandle | null, rowIds: readonly RowIndex[] | null | undefined): void {
  if (!gpu) return;
  if (rowIds && rowIds.length > 0) gpu.setHighlightPoints([...rowIds]);
  else gpu.clearHighlight();
}

function applyPredicateFilter(gpu: ScatterplotHandle | null, bits: Uint32Array | null | undefined): void {
  if (!gpu) return;
  if (bits == null) gpu.clearPredicateFilter();
  else gpu.setPredicateFilter(bits);
}

export const ScatterGPUHost = forwardRef<ScatterGPUHostHandle, ScatterGPUHostProps>(function ScatterGPUHost(
  // eslint-disable-next-line @typescript-eslint/unbound-method
  { data, positionKey, config, onGpuError, onReady, pointStyle, highlightRowIds, predicateBits },
  ref,
) {
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const overlayElRef = useRef<HTMLCanvasElement | null>(null);
  const gpuRef = useRef<ScatterplotHandle | null>(null);
  const initKeyRef = useRef<string | null>(null);
  // Aborts an in-flight createScatterplot on re-init / unmount (§7.2).
  const initAbortRef = useRef<AbortController | null>(null);

  // Refs to latest props: lets maybeInitGpu be stable (empty deps)
  // while always reading current values. Synced in a layout effect so they
  // are current before any passive effect (and seeded for the mount commit,
  // where the canvas callback refs fire before effects).
  const dataRef = useRef<ScatterData | null>(data);
  const positionKeyRef = useRef<string | null>(positionKey);
  const onGpuErrorRef = useRef(onGpuError);
  const onReadyRef = useRef(onReady);
  const configRef = useRef(config);
  // Latest point style, read in the (stable) init path to re-apply after reinit.
  const pointStyleRef = useRef(pointStyle);
  const highlightRowIdsRef = useRef(highlightRowIds);
  const predicateBitsRef = useRef(predicateBits);

  // Device-lease state from the component host's DeviceBroker.
  const leaseState = useScatterDeviceLease();
  const services = useScatterServices();
  const leaseStateRef = useRef(leaseState);

  useLayoutEffect(() => {
    dataRef.current = data;
    positionKeyRef.current = positionKey;
    onGpuErrorRef.current = onGpuError;
    onReadyRef.current = onReady;
    configRef.current = config;
    pointStyleRef.current = pointStyle;
    highlightRowIdsRef.current = highlightRowIds;
    predicateBitsRef.current = predicateBits;
    leaseStateRef.current = leaseState;
  });

  /**
   * Attempt GPU initialization. Called from both the canvas callback ref
   * (fires on mount) and the positionKey effect (fires when data arrives).
   * Safe to call multiple times: skips if already initialized for the
   * current key or if prerequisites aren't met.
   */
  const maybeInitGpu = useCallback(() => {
    const canvas = canvasElRef.current;
    const overlay = overlayElRef.current;
    const currentData = dataRef.current;
    const currentKey = positionKeyRef.current;

    if (!canvas || !overlay || !currentData || !currentKey) return;

    // Wait for host.acquireDeviceLease() and never self-acquire, which would
    // double-count this instance in the broker.
    const currentLease = leaseStateRef.current;
    if (currentLease.error) {
      onGpuErrorRef.current(currentLease.error.message);
      return;
    }
    if (!currentLease.lease) return; // lease in flight: re-runs when it resolves

    if (initKeyRef.current === currentKey) return; // already initialized
    initKeyRef.current = currentKey;

    if (!navigator.gpu) {
      onGpuErrorRef.current("WebGPU not supported. Use Chrome, Edge, or Safari 18+.");
      return;
    }

    // Abort any in-flight init and destroy the previous instance before
    // re-initializing: no stranded device on churn.
    initAbortRef.current?.abort();
    gpuRef.current?.destroy();
    gpuRef.current = null;
    const abort = new AbortController();
    initAbortRef.current = abort;

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

    createScatterplot(canvas, overlay, currentData, configRef.current, {
      signal: abort.signal,
      lease: currentLease.lease,
    })
      .then((gpu) => {
        // Superseded by a newer init or unmounted while initializing: discard.
        if (abort.signal.aborted) {
          gpu.destroy();
          return;
        }
        gpuRef.current = gpu;
        applyPointStyle(gpu, pointStyleRef.current);
        applyHighlight(gpu, highlightRowIdsRef.current);
        applyPredicateFilter(gpu, predicateBitsRef.current);
        onReadyRef.current(currentData.numCells);
      })
      .catch((err: unknown) => {
        // Expected when teardown aborted the in-flight device acquire.
        if (err instanceof DOMException && err.name === "AbortError") return;
        onGpuErrorRef.current(err instanceof Error ? err.message : String(err));
      });
  }, []); // stable: all reads through refs

  // Canvas callback refs: fire when the canvas element mounts/unmounts.
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

  // positionKey effect: fires when positions arrive or change.
  // Uses a string dep (safe) instead of Float32Array reference equality.
  useEffect(() => {
    if (!positionKey) {
      // No positions: reset so the next positionKey triggers re-init
      initKeyRef.current = null;
      initAbortRef.current?.abort();
      gpuRef.current?.destroy();
      gpuRef.current = null;
      return;
    }
    maybeInitGpu();
  }, [positionKey, maybeInitGpu]);

  // Re-attempt init when the device lease resolves or its state changes (managed
  // path). maybeInitGpu is guarded by initKeyRef, so this is a no-op once
  // initialized; on first lease resolution it is what kicks off GPU init.
  useEffect(() => {
    if (leaseState.lease || leaseState.error) maybeInitGpu();
  }, [leaseState, maybeInitGpu]);

  // ResizeObserver: keeps canvas pixel dimensions in sync with CSS size
  useEffect(() => {
    const canvas = canvasElRef.current;
    if (!canvas) return () => {};

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
      gpuRef.current?.resize();

      // If GPU wasn't initialized (clientWidth was 0 at mount), try now
      if (!initKeyRef.current) maybeInitGpu();
    });
    obs.observe(canvas);
    return () => {
      obs.disconnect();
    };
  }, [maybeInitGpu]);

  // Destroy GPU on unmount
  useEffect(() => {
    return () => {
      initAbortRef.current?.abort();
      gpuRef.current?.destroy();
      gpuRef.current = null;
    };
  }, []);

  // Surface a genuine GPU device loss as a host error so the parent shows its
  // "reload to restore" overlay instead of a silently frozen canvas.
  useEffect(
    () =>
      services.onDeviceLost((info) => {
        onGpuErrorRef.current(`GPU device lost (${info.reason}). Reload to restore the view.`);
      }),
    [services],
  );

  // Declarative point style → GPU. Applied on change here; re-applied on GPU
  // reinit in the init path above (via pointStyleRef). The prop is memoized by
  // the parent so this only fires when a style value actually changes.
  useEffect(() => {
    applyPointStyle(gpuRef.current, pointStyle);
  }, [pointStyle]);

  // Declarative highlight set → GPU (re-applied on reinit via the ref above).
  useEffect(() => {
    applyHighlight(gpuRef.current, highlightRowIds);
  }, [highlightRowIds]);

  useEffect(() => {
    applyPredicateFilter(gpuRef.current, predicateBits);
  }, [predicateBits]);

  // Expose imperative handle to parent
  useImperativeHandle(
    ref,
    () => ({
      setColors(palette, indices) {
        gpuRef.current?.updateColors(palette, indices);
      },
      setPointRadius(radius) {
        gpuRef.current?.setPointRadius(radius);
      },
      setPointOpacity(opacity) {
        gpuRef.current?.setPointOpacity(opacity);
      },
      setBlendMode(mode) {
        gpuRef.current?.setBlendMode(mode);
      },
      setHdrSettings(settings) {
        gpuRef.current?.setHdrSettings(settings);
      },
      setContinuousColors(args) {
        gpuRef.current?.updateContinuousColors(args);
      },
      setContinuousRange(vmin, vmax) {
        gpuRef.current?.setContinuousRange(vmin, vmax);
      },
      setContinuousReversed(reversed) {
        gpuRef.current?.setContinuousReversed(reversed);
      },
      setContinuousScale(scale) {
        gpuRef.current?.setContinuousScale(scale);
      },
      setContinuousLut(lut) {
        gpuRef.current?.setContinuousLut(lut);
      },
      getViewState() {
        return gpuRef.current?.getViewState() ?? { panX: 0, panY: 0, zoom: 1 };
      },
      project(x, y, z) {
        return gpuRef.current?.project(x, y, z) ?? { x: 0, y: 0 };
      },
      setExternalSelection(params) {
        gpuRef.current?.setExternalSelection(params);
      },
      clearExternalSelection() {
        gpuRef.current?.clearExternalSelection();
      },
      clearSelection() {
        gpuRef.current?.clearSelection();
      },
      setPredicateFilter(bits) {
        gpuRef.current?.setPredicateFilter(bits);
      },
      clearPredicateFilter() {
        gpuRef.current?.clearPredicateFilter();
      },
      setCategoryIsolation(isolated) {
        gpuRef.current?.setCategoryIsolation(isolated);
      },
      clearCategoryIsolation() {
        gpuRef.current?.clearCategoryIsolation();
      },
      setCategoryDisabled(disabled) {
        gpuRef.current?.setCategoryDisabled(disabled);
      },
      clearCategoryDisabled() {
        gpuRef.current?.clearCategoryDisabled();
      },
      setTrajectoryIsolation(rowIndices: RowIndex[]) {
        gpuRef.current?.setTrajectoryIsolation(rowIndices);
      },
      clearTrajectoryIsolation() {
        gpuRef.current?.clearTrajectoryIsolation();
      },
      setContinuousIsolation(rowIndices: RowIndex[]) {
        gpuRef.current?.setContinuousIsolation(rowIndices);
      },
      clearContinuousIsolation() {
        gpuRef.current?.clearContinuousIsolation();
      },
      setHighlightPoints(rowIndices: RowIndex[]) {
        gpuRef.current?.setHighlightPoints(rowIndices);
      },
      clearHighlight() {
        gpuRef.current?.clearHighlight();
      },
      setViewState(state) {
        gpuRef.current?.setViewState(state);
      },
      animateToViewState(state, durationMs) {
        gpuRef.current?.animateToViewState(state, durationMs);
      },
      setForcedSelectionMode(mode) {
        gpuRef.current?.setForcedSelectionMode(mode);
      },
    }),
    [],
  );

  // Backdrop behind the GPU canvas: the element's surface, not the page's.
  return (
    <div className="absolute inset-0 bg-surface">
      <canvas ref={canvasCallbackRef} className="absolute inset-0 h-full w-full" style={{ display: "block" }} />
      <canvas
        ref={overlayCallbackRef}
        className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
        style={{ display: "block" }}
      />
    </div>
  );
});
