/**
 * ScatterView: inner GPU rendering layer for a single scatter panel.
 *
 * Owns all WebGPU state: positions, colors, selection sync, view sync,
 * trajectory overlay, continuous range filter, and legend binding.
 * Rendered inside a LegendProvider by ScatterContent.
 */

import { useThrottler } from "@tanstack/react-pacer";
import { useSelector } from "@tanstack/react-store";
import { type RowIndex, rowIndex } from "@ndea/sdk";
import type { Coordinator } from "@uwdata/mosaic-core";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DatasetSessionActions } from "@/core/session/dataset-session";
import type { CategoryMapping } from "@/lib/color/category-column";
import { colorSourceFromString, colorSourceLegendLabel } from "@/lib/color/color-source";
import { toRows } from "@/lib/mosaic-helpers";
import {
  ScatterGPUHost,
  type ScatterGPUHostHandle,
  type ScatterPointStyle,
} from "@/nodes/scatter/gpu/components/ScatterGpuHost";
import { GpuDeviceProvider } from "@/core/gpu/gpu-device-context";
import { useHost } from "@/core/host/host-context";
import { broadcastView, focusPoint, publishRangeFilter } from "./routing";
import { type ColorMode, useMosaicScatterData } from "@/nodes/scatter/gpu/hooks/useMosaicScatterData";
import { useScatterBrushSync } from "@/nodes/scatter/gpu/hooks/useScatterBrushSync";
import type { ScatterplotConfig } from "@/nodes/scatter/gpu/types";
import { type GpuPointIndex, gpuPointIndex } from "@/lib/branded-types";
import { hexToRgbPalette } from "@/nodes/scatter/gpu/utils/colors";
import { buildColormapLut } from "@/lib/color/ochre-lut";
import { pointRadiusStore } from "@/stores/point-radius-store";
import { renderSettingsStore } from "@/stores/render-settings-store";
import type { AxisState, Metadata, TrajectoryData } from "@/types";
import { CategoricalLegend } from "./CategoricalLegend";
import { ContinuousLegend } from "./ContinuousLegend";
import { useEffectiveCategoryColors, useLegend } from "./LegendContext";
import { useScatterUIDispatch } from "./scatter-ui-store";
import type { TrajectoryOverlaySvgHandle } from "./TrajectoryOverlaySvg";
import { TrajectoryOverlaySvg } from "./TrajectoryOverlaySvg";
import { HighlightFocusOverlay, type HighlightFocusOverlayHandle } from "./HighlightFocusOverlay";
import type { ScatterCapabilities } from "./plugin";

export interface ScatterViewProps {
  selectionTool: "pan" | "marquee" | "lasso";
  isolationHandleRef?: RefObject<{
    setCategoryIsolation(s: Set<number>, c: Uint8Array): void;
    clearCategoryIsolation(): void;
  } | null>;
  categoryIndicesRef?: RefObject<Uint8Array | null>;
  fitViewRef?: RefObject<(() => void) | null>;
  /** Hoisted ref: populated by ScatterView but owned by ScatterContent */
  rowIndicesRef?: RefObject<RowIndex[]>;
  /** Called when GPU readback updates the row index list */
  onRowIndicesChange?: (indices: RowIndex[]) => void;
  axes: AxisState | null;
  isLoading: boolean;
  loadingKey: string | null;
  currentEntryLoaded: boolean;
  coordinator: Coordinator;
  table: string;
  xCol: string;
  yCol: string;
  colorMode: ColorMode;
  categoryCol: string | null;
  categoryMapping: CategoryMapping | null;
  colorByColumn: string | null;
  continuousColormap: string;
  trajectory: TrajectoryData | null;
  activeTrajectories: TrajectoryData[];
  metadata: Metadata;
  actions: DatasetSessionActions;
  focusedRowIndex: RowIndex | null;
}

export function ScatterView({
  selectionTool,
  axes,
  isLoading,
  loadingKey,
  currentEntryLoaded,
  coordinator,
  table: _table,
  xCol,
  yCol,
  colorMode,
  categoryCol,
  categoryMapping,
  colorByColumn,
  continuousColormap,
  trajectory,
  activeTrajectories,
  metadata: _metadata,
  actions,
  focusedRowIndex,
  isolationHandleRef,
  categoryIndicesRef,
  fitViewRef,
  rowIndicesRef: externalRowIndicesRef,
  onRowIndicesChange,
}: ScatterViewProps) {
  const categoryColors = useEffectiveCategoryColors();
  const { setFps, setZoom, setSelection, setEmbedding, setNumPoints } = useScatterUIDispatch();
  // Every scatter body is mounted with its capability-gated node host.
  const host = useHost<unknown, ScatterCapabilities>();

  // Point style as a declarative prop (slice 1 of the <ScatterCanvas> contract).
  // Human-cadence (sliders/settings) so re-rendering on change is fine: unlike
  // the 60fps camera path, which deliberately stays on the imperative bus.
  const pointRadius = useSelector(pointRadiusStore, (s) => s.radius);
  const renderSettings = useSelector(renderSettingsStore, (s) => s);
  const pointStyle = useMemo<ScatterPointStyle>(
    () => ({
      radius: pointRadius,
      opacity: renderSettings.pointOpacity,
      blendMode: renderSettings.blendMode,
      toneMapping: renderSettings.toneMapping,
      exposure: renderSettings.exposure,
    }),
    [
      pointRadius,
      renderSettings.pointOpacity,
      renderSettings.blendMode,
      renderSettings.toneMapping,
      renderSettings.exposure,
    ],
  );

  // ── Bridge legendState colormap + reversed to useMosaicScatterData ─────────
  // LegendContext owns colormapName and colormapReversed for continuous mode.
  // We read them here (inside LegendProvider) and override the colormap prop
  // when in continuous mode, so the query key reacts to legend changes.
  const { state: legendState, actions: legendActions } = useLegend();
  const effectiveColormap = colorMode === "continuous" ? legendState.colormapName : continuousColormap;
  const effectiveReversed = colorMode === "continuous" ? legendState.colormapReversed : false;

  const hostRef = useRef<ScatterGPUHostHandle | null>(null);

  // Keep refs in sync after every render so that LegendProvider's isolation
  // callbacks reach the GPU host with the latest data.
  useEffect(() => {
    if (isolationHandleRef) isolationHandleRef.current = hostRef.current;
    if (categoryIndicesRef) categoryIndicesRef.current = data?.categoryIndices ?? null;
    if (fitViewRef) fitViewRef.current = handleFitView;
  });

  useEffect(() => {
    hostRef.current?.setForcedSelectionMode(selectionTool);
  }, [selectionTool]);

  const containerRef = useRef<HTMLDivElement>(null);
  const trajectoryOverlayRef = useRef<TrajectoryOverlaySvgHandle | null>(null);
  const highlightOverlayRef = useRef<HighlightFocusOverlayHandle | null>(null);
  const gpuAdapter = useRef({
    worldToScreen: (wx: number, wy: number, w: number, h: number) =>
      hostRef.current?.worldToScreen(wx, wy, w, h) ?? { x: 0, y: 0 },
  });

  const viewStateRef = useRef({ panX: 0, panY: 0, zoom: 1 });
  const _localRowIndicesRef = useRef<RowIndex[]>([]);
  const rowIndicesRef = externalRowIndicesRef ?? _localRowIndicesRef;
  const [gpuError, setGpuError] = useState<string | null>(null);

  // ── Continuous range filter handles (dim-only: colormap is NOT remapped) ──
  const [userVmin, setUserVmin] = useState<number | undefined>();
  const [userVmax, setUserVmax] = useState<number | undefined>();
  // Route the continuous-range predicate through the node host.
  const publishRange = useCallback((sql: string | null) => publishRangeFilter(host, sql), [host]);

  // Reset filter when column changes
  useEffect(() => {
    setUserVmin(undefined);
    setUserVmax(undefined);
    publishRange(null);
  }, [colorByColumn, publishRange]);

  const {
    data,
    positionKey,
    positionScale,
    colorRange,
    loading: dataLoading,
  } = useMosaicScatterData({
    axes,
    xCol,
    yCol,
    colorMode,
    categoryCol,
    originalCol: colorByColumn,
    continuousColCol: colorMode === "continuous" ? colorByColumn : null,
    continuousColormap: effectiveColormap,
    continuousReversed: effectiveReversed,
    embeddingLoaded: currentEntryLoaded,
    // vmin/vmax intentionally NOT passed: colormap stays fixed at full data range;
    // the slider only controls which points are dimmed via GPU isolation mask.
  });

  // Trajectory points render full-bright via the GPU highlight buffer (slice (a)
  // of the packed-flags contract). Single-point focus is handled by
  // HighlightFocusOverlay instead: a lone bright point is invisible under
  // additive blending.
  const highlightRowIds = useMemo<RowIndex[] | null>(
    () =>
      activeTrajectories.length === 0
        ? null
        : activeTrajectories.flatMap((t) =>
            t.points
              .map((p) => p.rowIndex)
              .filter((id): id is number => id != null)
              .map(rowIndex),
          ),
    [activeTrajectories],
  );

  // Single-point focus → screen marker. focusedRowIndex is the clicked obs's
  // __row_index__; resolve it to a normalized world position via the
  // rowIndex→point inverse. Suppressed while a trajectory is active (that has
  // its own overlay).
  const rowToPoint = useMemo(() => {
    const m = new Map<RowIndex, GpuPointIndex>();
    const ri = data?.rowIndices;
    if (ri) for (let i = 0; i < ri.length; i++) m.set(ri[i], gpuPointIndex(i));
    return m;
  }, [data?.rowIndices]);
  const highlightWorldPos = useMemo<[number, number] | null>(() => {
    if (activeTrajectories.length > 0 || focusedRowIndex == null || !data) return null;
    const pi = rowToPoint.get(focusedRowIndex);
    if (pi == null) return null;
    return [data.positions[2 * pi], data.positions[2 * pi + 1]];
  }, [focusedRowIndex, activeTrajectories, data, rowToPoint]);

  // Trajectory isolation mask: each feature owns its own mask; no mutual
  // exclusion needed. (Highlight moved to the prop above.)
  useEffect(() => {
    if (activeTrajectories.length === 0) {
      hostRef.current?.clearTrajectoryIsolation();
      return () => {};
    }
    const rowIndices = activeTrajectories.flatMap((t) =>
      t.points
        .map((p) => p.rowIndex)
        .filter((id): id is number => id != null)
        .map(rowIndex),
    );
    if (rowIndices.length > 0) {
      hostRef.current?.setTrajectoryIsolation(rowIndices);
    }
    return () => {
      hostRef.current?.clearTrajectoryIsolation();
    };
  }, [activeTrajectories]);

  // Continuous range isolation: independent mask; no trajectory guards needed.
  useEffect(() => {
    if (colorMode !== "continuous" || !colorByColumn || userVmin === undefined || userVmax === undefined) {
      hostRef.current?.clearContinuousIsolation();
      publishRange(null);
      return () => {};
    }
    const col = colorByColumn;
    const vmin = userVmin;
    const vmax = userVmax;
    publishRange(`"${col}" >= ${vmin} AND "${col}" <= ${vmax}`);
    let cancelled = false;
    const tid = setTimeout(() => {
      coordinator
        .query(`SELECT __row_index__ FROM dataset WHERE "${col}" >= ${vmin} AND "${col}" <= ${vmax}`, {
          type: "json",
        })
        .then((result: unknown) => {
          if (cancelled) return;
          const indices = toRows<{ __row_index__: number }>(result).map((r) => rowIndex(r.__row_index__));
          hostRef.current?.setContinuousIsolation(indices);
        })
        .catch(() => {
          if (!cancelled) hostRef.current?.clearContinuousIsolation();
        });
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(tid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, colorByColumn, userVmin, userVmax, coordinator, publishRange]);

  // ── Fit-view ──────────────────────────────────────────────────────────────
  const handleFitView = useCallback(() => {
    const positions = data?.positions;
    const el = containerRef.current;
    if (!positions || positions.length < 2 || !el) return;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 2) {
      const x = positions[i],
        y = positions[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX) || minX === maxX || minY === maxY) return;
    const aspect = el.clientWidth / el.clientHeight || 1;
    const padding = 0.88;
    const zoom = Math.min((2 * padding) / (maxY - minY), (2 * aspect * padding) / (maxX - minX));
    hostRef.current?.animateToViewState(
      {
        panX: -(minX + maxX) / 2,
        panY: -(minY + maxY) / 2,
        zoom,
      },
      600,
    );
  }, [data?.positions]);

  const viewBroadcaster = useThrottler(
    (vs: { panX: number; panY: number; zoom: number }) => {
      broadcastView(host, vs); // host seam; no-op unless this node is view-sync linked
    },
    { wait: 16 },
  );

  const { onSelectionChange } = useScatterBrushSync({
    rowIndicesRef,
    setSelection,
  });

  const hasLassoRef = useRef(false);
  const clearLassoSelection = useCallback(() => {
    if (!hasLassoRef.current) return false;
    hostRef.current?.clearSelection();
    setSelection(null);
    hasLassoRef.current = false;
    return true;
  }, [setSelection]);

  const callbacksRef = useRef({
    onSelectionChange: (_count: number | null, _indices?: GpuPointIndex[]) => {},
    onExternalClear: () => {},
    onPointClick: (_index: GpuPointIndex, _pos: [number, number], _catIdx: number, _catName: string) => {},
    onBackgroundClick: () => {},
    onViewChange: (_state: { panX: number; panY: number; zoom: number }) => {},
    onFps: (_fps: number) => {},
  });

  callbacksRef.current.onSelectionChange = (...args) => {
    hasLassoRef.current = args[0] != null && args[0] > 0;
    onSelectionChange(...args);
  };
  callbacksRef.current.onExternalClear = () => setSelection(null);
  const setFocus = (nextFocus: RowIndex | null) => focusPoint(host, nextFocus);
  callbacksRef.current.onBackgroundClick = () => {
    setFocus(null);
    clearLassoSelection();
  };
  callbacksRef.current.onPointClick = (pointIndex) => {
    const clickedRowIndex = rowIndicesRef.current[pointIndex];
    if (clickedRowIndex != null) setFocus(clickedRowIndex);
  };
  callbacksRef.current.onViewChange = (state) => {
    viewStateRef.current = state;
    setZoom(state.zoom);
    trajectoryOverlayRef.current?.update();
    highlightOverlayRef.current?.update();
    viewBroadcaster.maybeExecute(state);
  };
  callbacksRef.current.onFps = (fps) => setFps(fps);

  const configRef = useRef<ScatterplotConfig>({
    callbacks: {
      onSelectionChange: (...args) => callbacksRef.current.onSelectionChange(...args),
      onPointClick: (...args) => callbacksRef.current.onPointClick(...args),
      onBackgroundClick: () => callbacksRef.current.onBackgroundClick(),
      onViewChange: (...args) => callbacksRef.current.onViewChange(...args),
      onFps: (...args) => callbacksRef.current.onFps(...args),
    },
  });

  const paletteRef = useRef<readonly (readonly [number, number, number, number?])[]>([]);

  // ── GPU state rehydration ─────────────────────────────────────────────────
  // When the embedding changes, the GPU destroys and re-creates. All imperative
  // state (colors, point size, selection mode) must be re-applied to the new
  // GPU instance. positionKey is the stable signal for GPU re-init.
  useEffect(() => {
    if (!positionKey) return;
    // Colors
    if (colorMode === "categorical") {
      const colors = categoryColors ?? [];
      if (colors.length > 0 && !colors.some((c) => !c)) {
        const palette = hexToRgbPalette(colors);
        paletteRef.current = palette;
        hostRef.current?.setColors(palette, data?.categoryIndices);
      }
    } else if (colorMode === "continuous" && data?.continuous) {
      const c = data.continuous;
      hostRef.current?.setContinuousColors({
        values: c.values,
        vmin: c.vmin,
        vmax: c.vmax,
        lut: buildColormapLut(c.colormap),
        reversed: c.reversed,
        scale: legendState.scale,
      });
    }
    // Point style (radius/opacity/blend/HDR) is now a declarative `pointStyle`
    // prop on ScatterGPUHost: applied there, and re-applied on GPU reinit.
    // Selection tool
    hostRef.current?.setForcedSelectionMode(selectionTool);
    // Re-upload all isolation masks from CPU state after GPU reinit
    hostRef.current?.rehydrateIsolation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionKey]); // intentionally only positionKey: this runs once per GPU init

  useEffect(() => {
    if (colorMode !== "categorical") return;
    const colors = categoryColors ?? [];
    if (colors.length === 0 || colors.some((c) => !c)) return;
    const palette = hexToRgbPalette(colors);
    paletteRef.current = palette;
    hostRef.current?.setColors(palette, data?.categoryIndices);
  }, [categoryColors, colorMode, data?.categoryIndices]);

  useEffect(() => {
    if (colorMode !== "continuous" || !data?.continuous) return;
    const c = data.continuous;
    hostRef.current?.setContinuousColors({
      values: c.values,
      vmin: c.vmin,
      vmax: c.vmax,
      lut: buildColormapLut(c.colormap),
      reversed: c.reversed,
      scale: legendState.scale,
    });
  }, [data?.continuous, colorMode, legendState.scale]);

  // Phase 7: slider-driven vmin/vmax → GPU uniform + re-dispatch, no re-fetch.
  useEffect(() => {
    if (colorMode !== "continuous" || !data?.continuous) return;
    if (userVmin === undefined || userVmax === undefined) return;
    hostRef.current?.setContinuousRange(userVmin, userVmax);
  }, [userVmin, userVmax, colorMode, data?.continuous]);

  // Legend toggle handlers that skip LUT/value re-upload.
  useEffect(() => {
    if (colorMode !== "continuous" || !data?.continuous) return;
    hostRef.current?.setContinuousReversed(legendState.colormapReversed);
  }, [legendState.colormapReversed, colorMode, data?.continuous]);

  useEffect(() => {
    if (colorMode !== "continuous" || !data?.continuous) return;
    hostRef.current?.setContinuousScale(legendState.scale);
  }, [legendState.scale, colorMode, data?.continuous]);

  // External (cross-panel, non-self) selection → GPU dim-mask, read through the
  // host row-set channel.
  useEffect(() => {
    const apply = (rowIndices: readonly RowIndex[] | null) => {
      if (rowIndices === null) hostRef.current?.clearExternalSelection();
      else hostRef.current?.setExternalSelection([...rowIndices]);
    };
    apply(host.externalRowSet()); // seed an already-active selection on mount
    return host.onExternalRowSet(apply);
  }, [host]);

  useEffect(() => {
    // incoming (non-self) pan/zoom on this node's view-sync scope, via the host
    // seam and its current coordination scope.
    return host.viewCoordination.subscribe?.((s) => {
      hostRef.current?.setViewState({ panX: s.panX, panY: s.panY, zoom: s.zoom });
    });
  }, [host]);

  // (point radius / opacity / blend / HDR now flow declaratively via the
  // `pointStyle` prop above: the two store-subscription effects they replaced
  // are gone.)

  // (GPU highlight now flows via the `highlightRowIds` prop, derived from
  // activeTrajectories. When focus clears the trajectory is cleared, which
  // empties highlightRowIds → the host clears the glow. No separate effect.)

  // Escape clears point and brush selections together. Category isolation
  // handles Escape only when none of these states is active.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;

      let handled = clearLassoSelection();
      if (focusedRowIndex != null) {
        focusPoint(host, null);
        handled = true;
      }
      if (trajectory) {
        actions.clearTrajectory(trajectory.datasetKey ?? "");
        handled = true;
      }

      if (!handled) return; // let event propagate to CategoricalLegend's Escape handler
      e.stopPropagation();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusedRowIndex, host, trajectory, actions, clearLassoSelection]);

  const axesKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = axes ? `${axes.obsmKey}:${axes.xDim}:${axes.yDim}` : null;
    const changed = axesKeyRef.current != null && key !== axesKeyRef.current;
    axesKeyRef.current = key;
    if (changed) actions.clearTrajectory(trajectory?.datasetKey ?? "");
    setEmbedding(axes?.obsmKey ?? null);
  }, [axes, actions, setEmbedding, trajectory]);

  useEffect(() => {
    if (focusedRowIndex == null && trajectory) actions.clearTrajectory(trajectory.datasetKey ?? "");
  }, [focusedRowIndex, trajectory, actions]);

  const showLoading = isLoading || dataLoading;

  // Inline JSX below: a nested component would get a fresh function
  // identity on every render, unmounting the slider mid-drag and dropping
  // pointer capture (track clicks still worked; thumb drags didn't).
  const continuousLegend =
    colorMode === "continuous" && colorByColumn && colorRange ? (
      <ContinuousLegend
        columnName={colorSourceLegendLabel(colorSourceFromString(colorByColumn))}
        colormap={legendState.colormapName}
        reversed={legendState.colormapReversed}
        scale={legendState.scale}
        vmin={userVmin ?? colorRange[0]}
        vmax={userVmax ?? colorRange[1]}
        absoluteVmin={colorRange[0]}
        absoluteVmax={colorRange[1]}
        onColormapChange={legendActions.setColormap}
        onReversedChange={legendActions.setColormapReversed}
        onScaleChange={legendActions.setScale}
        onResetRange={() => {
          setUserVmin(colorRange[0]);
          setUserVmax(colorRange[1]);
        }}
        onRangeChange={(vmin, vmax) => {
          setUserVmin(vmin);
          setUserVmax(vmax);
        }}
      />
    ) : null;

  if (!axes) {
    return (
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden text-sm text-muted-foreground">
        No embedding loaded
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative min-h-0 flex-1 overflow-hidden${trajectory ? "trajectory-active" : ""}`}
    >
      {/* GpuDeviceProvider sits below the `!axes` guard, so an empty scatter
          acquires no device. */}
      <GpuDeviceProvider>
        <ScatterGPUHost
          ref={hostRef}
          data={data}
          positionKey={positionKey}
          config={configRef.current}
          pointStyle={pointStyle}
          highlightRowIds={highlightRowIds}
          onGpuError={setGpuError}
          onRowIndicesChange={(indices) => {
            rowIndicesRef.current = indices;
            setNumPoints(indices.length);
            onRowIndicesChange?.(indices);
          }}
        />
      </GpuDeviceProvider>
      {showLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/50 text-sm text-muted-foreground">
          Loading{loadingKey ? ` ${loadingKey.replace(/^X_/, "")}...` : "..."}
        </div>
      )}
      {gpuError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-4 text-center text-red-400 text-sm">
          {gpuError}
        </div>
      )}
      {activeTrajectories.map((traj) => {
        const tActiveIdx = traj.points.findIndex((p) => p.t === traj.tIndex);
        return (
          <TrajectoryOverlaySvg
            key={traj.datasetKey ?? "default"}
            ref={traj === trajectory ? trajectoryOverlayRef : null}
            points={traj.points}
            activeIndex={tActiveIdx >= 0 ? tActiveIdx : null}
            categoryColors={categoryColors ?? []}
            containerRef={containerRef}
            gpuRef={gpuAdapter}
            positionScale={positionScale}
          />
        );
      })}
      <HighlightFocusOverlay
        ref={highlightOverlayRef}
        worldPos={highlightWorldPos}
        containerRef={containerRef}
        gpuRef={gpuAdapter}
      />
      {colorMode === "categorical" && categoryMapping && !showLoading ? <CategoricalLegend /> : null}
      {continuousLegend}
    </div>
  );
}
