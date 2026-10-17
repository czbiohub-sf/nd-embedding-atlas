/**
 * ScatterView: inner GPU rendering layer for a single scatter panel.
 *
 * Owns all WebGPU state: positions, colors, selection sync, view sync,
 * trajectory overlay, continuous range filter, and legend binding.
 * Rendered inside a LegendProvider by ScatterContent.
 */

import { useThrottler } from "@tanstack/react-pacer";
import { useSelector } from "@tanstack/react-store";
import type { FilterClause } from "@ndea/protocol";
import { type RowIndex, rowIndex } from "@ndea/sdk";
import type { Coordinator } from "@uwdata/mosaic-core";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScatterGPUHost, type ScatterGPUHostHandle, type ScatterPointStyle } from "./gpu/components/ScatterGpuHost";
import { ScatterDeviceLeaseProvider, useScatterHost, useScatterServices } from "./context";
import type { AxisState, CategoryMapping, ColorMode, Metadata, ScatterSession, TrajectoryData } from "./contracts";
import { colorSourceFromString, colorSourceLegendLabel, toRows } from "./helpers";
import { useMosaicScatterData } from "./gpu/hooks/useMosaicScatterData";
import { useScatterBrushSync } from "./gpu/hooks/useScatterBrushSync";
import { usePredicateBits } from "./gpu/hooks/usePredicateBits";
import type { ScatterplotConfig } from "./gpu/types";
import { hexToRgbPalette } from "./gpu/utils/colors";
import { CategoricalLegend } from "./CategoricalLegend";
import { ContinuousLegend } from "./ContinuousLegend";
import { useEffectiveCategoryColors, useLegend } from "./LegendContext";
import { useScatterUIDispatch } from "./scatter-ui-store";
import type { TrajectoryOverlaySvgHandle } from "./TrajectoryOverlaySvg";
import { TrajectoryOverlaySvg } from "./TrajectoryOverlaySvg";
import { HighlightFocusOverlay, type HighlightFocusOverlayHandle } from "./HighlightFocusOverlay";

export interface ScatterViewProps {
  selectionTool: "pan" | "marquee" | "lasso";
  isolationHandleRef?: RefObject<{
    setCategoryIsolation(isolated: Set<number>): void;
    clearCategoryIsolation(): void;
  } | null>;
  fitViewRef?: RefObject<(() => void) | null>;
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
  actions: ScatterSession["actions"];
  focusedRowIndex: RowIndex | null;
}

export function ScatterView({
  selectionTool,
  axes,
  isLoading,
  loadingKey,
  currentEntryLoaded,
  coordinator,
  table,
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
  fitViewRef,
}: ScatterViewProps) {
  const categoryColors = useEffectiveCategoryColors();
  const { setFps, setZoom, setSelection, setEmbedding, setNumPoints } = useScatterUIDispatch();
  // Every scatter body is mounted with its component host.
  const host = useScatterHost();
  const services = useScatterServices();

  // Point style as a declarative prop (slice 1 of the <ScatterCanvas> contract).
  // Human-cadence (sliders/settings) so re-rendering on change is fine: unlike
  // the 60fps camera path, which deliberately stays on the imperative bus.
  const pointRadius = useSelector(services.pointRadiusStore, (state) => state.radius);
  const renderSettings = useSelector(services.renderSettingsStore, (state) => state);
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
  const { bits: predicateBits, error: predicateFilterError } = usePredicateBits({
    coordinator,
    filter: host.filter,
    table,
  });

  // Keep refs in sync after every render so that LegendProvider's isolation
  // callbacks reach the GPU host with the latest data.
  useEffect(() => {
    if (isolationHandleRef) isolationHandleRef.current = hostRef.current;
    if (fitViewRef) fitViewRef.current = handleFitView;
  });

  useEffect(() => {
    hostRef.current?.setForcedSelectionMode(selectionTool);
  }, [selectionTool]);

  const containerRef = useRef<HTMLDivElement>(null);
  const trajectoryOverlayRef = useRef<TrajectoryOverlaySvgHandle | null>(null);
  const highlightOverlayRef = useRef<HighlightFocusOverlayHandle | null>(null);
  const gpuAdapter = useRef({
    project: (x: number, y: number) => hostRef.current?.project(x, y) ?? { x: 0, y: 0 },
  });

  const viewStateRef = useRef({ panX: 0, panY: 0, zoom: 1 });
  const [gpuError, setGpuError] = useState<string | null>(null);

  // ── Continuous range filter handles (dim-only: colormap is NOT remapped) ──
  const [userVmin, setUserVmin] = useState<number | undefined>();
  const [userVmax, setUserVmax] = useState<number | undefined>();
  // Route the continuous-range predicate through the component host.
  const publishRange = useCallback(
    (clause: FilterClause | null) => {
      if (clause === null) host.filter.clear("range");
      else host.filter.publish("range", clause);
    },
    [host],
  );

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
  // __row_index__, which is its point index. Suppressed while a trajectory is
  // active (that has its own overlay).
  const highlightWorldPos = useMemo<[number, number] | null>(() => {
    if (activeTrajectories.length > 0 || focusedRowIndex == null || !data || focusedRowIndex >= data.numCells) {
      return null;
    }
    return [data.positions[2 * focusedRowIndex], data.positions[2 * focusedRowIndex + 1]];
  }, [focusedRowIndex, activeTrajectories, data]);

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
    publishRange({ op: "between", column: col, range: [vmin, vmax] });
    let cancelled = false;
    const tid = setTimeout(() => {
      coordinator
        .query(`SELECT __row_index__ FROM dataset WHERE "${col}" >= ${vmin} AND "${col}" <= ${vmax}`)
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
      if (host.viewSync.linked) host.viewSync.broadcast(vs);
    },
    { wait: 16 },
  );

  const { onSelectionChange } = useScatterBrushSync({ numPoints: data?.numCells ?? 0, setSelection });

  const hasLassoRef = useRef(false);
  const clearLassoSelection = useCallback(() => {
    if (!hasLassoRef.current) return false;
    hostRef.current?.clearSelection();
    setSelection(null);
    hasLassoRef.current = false;
    return true;
  }, [setSelection]);

  const callbacksRef = useRef({
    onSelectionChange: (_count: number | null, _bits?: Uint32Array<ArrayBuffer>) => {},
    onExternalClear: () => {},
    onPointClick: (_index: number, _pos: [number, number], _catIdx: number, _catName: string) => {},
    onBackgroundClick: () => {},
    onViewChange: (_state: { panX: number; panY: number; zoom: number }) => {},
    onFps: (_fps: number) => {},
  });

  callbacksRef.current.onSelectionChange = (...args) => {
    hasLassoRef.current = args[0] != null && args[0] > 0;
    onSelectionChange(...args);
  };
  callbacksRef.current.onExternalClear = () => setSelection(null);
  const setFocus = (nextFocus: RowIndex | null) => host.focus.set(nextFocus);
  callbacksRef.current.onBackgroundClick = () => {
    setFocus(null);
    clearLassoSelection();
  };
  callbacksRef.current.onPointClick = (pointIndex) => setFocus(rowIndex(pointIndex));
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

  // ── GPU state rehydration ─────────────────────────────────────────────────
  // Every GPU (re)init starts blank: colors, selection mode, and isolation are
  // re-applied once the new instance is ready (init is async, so a
  // positionKey effect would run before it exists).
  const onGpuReady = (numPoints: number) => {
    setNumPoints(numPoints);
    if (colorMode === "categorical") {
      const colors = categoryColors ?? [];
      if (colors.length > 0 && !colors.some((c) => !c)) {
        hostRef.current?.setColors(hexToRgbPalette(colors), data?.categoryIndices);
      }
    } else if (colorMode === "continuous" && data?.continuous) {
      const c = data.continuous;
      hostRef.current?.setContinuousColors({
        values: c.values,
        vmin: c.vmin,
        vmax: c.vmax,
        lut: services.buildColormapLut(c.colormap),
        reversed: c.reversed,
        scale: legendState.scale,
      });
    }
    // Point style (radius/opacity/blend/HDR) is a declarative `pointStyle`
    // prop on ScatterGPUHost: applied there, and re-applied on GPU reinit.
    hostRef.current?.setForcedSelectionMode(selectionTool);
  };

  useEffect(() => {
    if (colorMode !== "categorical") return;
    const colors = categoryColors ?? [];
    if (colors.length === 0 || colors.some((c) => !c)) return;
    hostRef.current?.setColors(hexToRgbPalette(colors), data?.categoryIndices);
  }, [categoryColors, colorMode, data?.categoryIndices]);

  useEffect(() => {
    if (colorMode !== "continuous" || !data?.continuous) return;
    const c = data.continuous;
    hostRef.current?.setContinuousColors({
      values: c.values,
      vmin: c.vmin,
      vmax: c.vmax,
      lut: services.buildColormapLut(c.colormap),
      reversed: c.reversed,
      scale: legendState.scale,
    });
  }, [data?.continuous, colorMode, legendState.scale, services]);

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

  useEffect(() => {
    // incoming (non-self) pan/zoom on this element's view-sync scope, via the host
    // seam and its current coordination scope.
    return host.viewSync.subscribe?.((s) => {
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
        host.focus.set(null);
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
  const errorMessage = gpuError ?? predicateFilterError?.message;

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
      {/* Device lease provider sits below the `!axes` guard, so an empty scatter
          acquires no device. */}
      <ScatterDeviceLeaseProvider>
        <ScatterGPUHost
          ref={hostRef}
          data={data}
          positionKey={positionKey}
          config={configRef.current}
          pointStyle={pointStyle}
          highlightRowIds={highlightRowIds}
          predicateBits={predicateBits}
          onGpuError={setGpuError}
          onReady={onGpuReady}
        />
      </ScatterDeviceLeaseProvider>
      {showLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/50 text-sm text-muted-foreground">
          Loading{loadingKey ? ` ${loadingKey.replace(/^X_/, "")}...` : "..."}
        </div>
      )}
      {errorMessage && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-4 text-center text-red-400 text-sm">
          {errorMessage}
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
