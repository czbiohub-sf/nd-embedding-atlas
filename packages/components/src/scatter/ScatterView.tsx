/**
 * ScatterView: inner GPU rendering layer for a single scatter panel.
 *
 * Owns all WebGPU state: positions, colors, selection sync, view sync,
 * trajectory overlay, continuous range filter, and legend binding.
 * Rendered inside a LegendProvider by ScatterContent.
 */

import { srgbFromHex, srgbToLinearRgb } from "@ndea/ochre";
import { useThrottler } from "@tanstack/react-pacer";
import { useSelector } from "@tanstack/react-store";
import type { FilterClause } from "@ndea/protocol";
import { type PanZoomView, type RowIndex, rowIndex, type TurntableView } from "@ndea/sdk";
import type { Coordinator } from "@uwdata/mosaic-core";
import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScatterGPUHost, type ScatterGPUHostHandle, type ScatterPointStyle } from "./gpu/components/ScatterGpuHost";
import { ScatterDeviceLeaseProvider, useScatterHost, useScatterServices } from "./context";
import type {
  AxisState,
  CategoryMapping,
  ColorMode,
  DensityMode,
  Metadata,
  ScatterSession,
  SelectionDepth,
  SelectionTool,
  TrajectoryData,
} from "./contracts";
import { colorSourceFromString, colorSourceLegendLabel, pointWorldPos, toRows, TRAJECTORY_COLOR } from "./helpers";
import { useMosaicScatterData } from "./gpu/hooks/useMosaicScatterData";
import { type ScatterSelection, useScatterSelection } from "./gpu/hooks/useScatterSelection";
import { usePredicateBits } from "./gpu/hooks/usePredicateBits";
import type { ScatterplotConfig } from "./gpu/types";
import { hexToRgbPalette } from "./gpu/utils/colors";
import { CategoricalLegend } from "./CategoricalLegend";
import { ContinuousLegend } from "./ContinuousLegend";
import { useEffectiveCategoryColors, useLegend } from "./LegendContext";
import { HighlightFocusOverlay, type HighlightFocusOverlayHandle } from "./HighlightFocusOverlay";

/** What the view hands its floating controls: the legend body (null when there is none) and the selection. */
export interface ScatterOverlays {
  legend: ReactNode;
  selection: ScatterSelection;
}

export interface ScatterViewProps {
  selectionTool: SelectionTool;
  /** Point radius in normalized device units. */
  pointSize: number;
  /** Controls floating over the canvas. */
  renderOverlays(overlays: ScatterOverlays): ReactNode;
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
  /** null = 2D. */
  zCol: string | null;
  projection: TurntableView["projection"];
  /** A synced 3D view changed the projection. */
  onProjectionChange(projection: TurntableView["projection"]): void;
  selectionDepth: SelectionDepth;
  densityMode: DensityMode;
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
  pointSize,
  renderOverlays,
  axes,
  isLoading,
  loadingKey,
  currentEntryLoaded,
  coordinator,
  table,
  xCol,
  yCol,
  zCol,
  projection,
  onProjectionChange,
  selectionDepth,
  densityMode,
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
  // Every scatter body is mounted with its component host.
  const host = useScatterHost();
  const services = useScatterServices();

  // Point style as a declarative prop (slice 1 of the <ScatterCanvas> contract).
  // Human-cadence (sliders/settings) so re-rendering on change is fine: unlike
  // the 60fps camera path, which deliberately stays on the imperative bus.
  const renderSettings = useSelector(services.renderSettingsStore, (state) => state);
  const pointStyle = useMemo<ScatterPointStyle>(
    () => ({
      radius: pointSize,
      opacity: renderSettings.pointOpacity,
      blendMode: renderSettings.blendMode,
      toneMapping: renderSettings.toneMapping,
      exposure: renderSettings.exposure,
    }),
    [
      pointSize,
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
  const { state: legendState } = useLegend();
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

  useEffect(() => {
    hostRef.current?.setProjection(projection);
  }, [projection]);

  useEffect(() => {
    hostRef.current?.setSelectionDepth(selectionDepth);
  }, [selectionDepth]);

  useEffect(() => {
    hostRef.current?.setDensityMode(densityMode);
  }, [densityMode]);

  const containerRef = useRef<HTMLDivElement>(null);
  const highlightOverlayRef = useRef<HighlightFocusOverlayHandle | null>(null);
  const gpuAdapter = useRef({
    project: (x: number, y: number, z?: number) => hostRef.current?.project(x, y, z) ?? null,
  });

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
    colorRange,
    loading: dataLoading,
  } = useMosaicScatterData({
    axes,
    xCol,
    yCol,
    zCol,
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
  // active (that has its own marker).
  const highlightWorldPos = useMemo(
    () => (activeTrajectories.length > 0 || focusedRowIndex == null ? null : pointWorldPos(data, focusedRowIndex)),
    [focusedRowIndex, activeTrajectories, data],
  );

  // Trajectory line pass input, from the scatter's own positions by rowIndex so the path sits
  // exactly on its points (frames whose row isn't loaded are skipped). Hue: the frame's category
  // color (else the trajectory color), as the points; alpha ramps early → late for direction.
  const trajectoryPath = useMemo(() => {
    if (activeTrajectories.length === 0 || !data) return null;
    const path: number[] = [];
    for (const traj of activeTrajectories) {
      if (path.length > 0) path.push(0, 0, 0, -1, 0, 0, 0, 0);
      const frames = traj.points.flatMap((p) => {
        const pos = pointWorldPos(data, p.rowIndex);
        return pos ? [{ p, pos }] : [];
      });
      frames.forEach(({ p, pos }, k) => {
        const category = p.category != null ? categoryColors?.[p.category] : undefined;
        // Empty while a palette loads; srgbFromHex would throw.
        const hex = category?.startsWith("#") ? category : TRAJECTORY_COLOR;
        // Linear RGB: the HDR composite encodes sRGB, so the path shows the exact hex.
        const { r, g, b } = srgbToLinearRgb(srgbFromHex(hex));
        const alpha = frames.length > 1 ? 0.4 + (0.6 * k) / (frames.length - 1) : 1;
        path.push(...pos, p.t === traj.tIndex ? 1 : 0, r, g, b, alpha);
      });
    }
    return new Float32Array(path);
  }, [activeTrajectories, data, categoryColors]);

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
  const handleFitView = useCallback(() => hostRef.current?.fitView(), []);

  const viewBroadcaster = useThrottler(
    (vs: PanZoomView | TurntableView) => {
      if (host.viewSync.linked) host.viewSync.broadcast(vs);
    },
    { wait: 16 },
  );

  const selection = useScatterSelection({
    numPoints: data?.numCells ?? 0,
    gpuRef: hostRef,
    tool: selectionTool === "box" ? "box" : "lasso",
  });

  const callbacksRef = useRef({
    onSelectionChange: selection.onSelectionChange,
    onPointClick: (_index: number) => {},
    onBackgroundClick: () => {},
    onViewChange: (_state: PanZoomView | TurntableView) => {},
  });

  callbacksRef.current.onSelectionChange = selection.onSelectionChange;
  const setFocus = (nextFocus: RowIndex | null) => host.focus.set(nextFocus);
  callbacksRef.current.onBackgroundClick = () => {
    setFocus(null);
    selection.clear();
  };
  callbacksRef.current.onPointClick = (pointIndex) => setFocus(rowIndex(pointIndex));
  callbacksRef.current.onViewChange = (state) => {
    highlightOverlayRef.current?.update();
    viewBroadcaster.maybeExecute(state);
  };

  const configRef = useRef<ScatterplotConfig>({
    callbacks: {
      onSelectionChange: (...args) => callbacksRef.current.onSelectionChange(...args),
      onPointClick: (...args) => callbacksRef.current.onPointClick(...args),
      onBackgroundClick: () => callbacksRef.current.onBackgroundClick(),
      onViewChange: (...args) => callbacksRef.current.onViewChange(...args),
    },
  });

  // ── GPU state rehydration ─────────────────────────────────────────────────
  // Every GPU (re)init starts blank: colors, selection mode, and isolation are
  // re-applied once the new instance is ready (init is async, so a
  // positionKey effect would run before it exists).
  const onGpuReady = () => {
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
    hostRef.current?.setProjection(projection);
    hostRef.current?.setSelectionDepth(selectionDepth);
    hostRef.current?.setDensityMode(densityMode);
    selection.restore();
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
    // incoming (non-self) view on this element's view-sync scope, via the host
    // seam and its current coordination scope. The camera skips the other
    // dimensionality's cells; a 3D cell also carries the projection.
    return host.viewSync.subscribe?.((s) => {
      hostRef.current?.setViewState(s);
      if (zCol !== null && s.projection) onProjectionChange(s.projection);
    });
  }, [host, zCol, onProjectionChange]);

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

      let handled = selection.clear();
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
  }, [focusedRowIndex, host, trajectory, actions, selection]);

  const axesKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = axes ? `${axes.obsmKey}:${axes.xDim}:${axes.yDim}:${axes.zDim}` : null;
    const changed = axesKeyRef.current != null && key !== axesKeyRef.current;
    axesKeyRef.current = key;
    if (changed) actions.clearTrajectory(trajectory?.datasetKey ?? "");
  }, [axes, actions, trajectory]);

  useEffect(() => {
    if (focusedRowIndex == null && trajectory) actions.clearTrajectory(trajectory.datasetKey ?? "");
  }, [focusedRowIndex, trajectory, actions]);

  const showLoading = isLoading || dataLoading;
  const errorMessage = gpuError ?? predicateFilterError?.message;

  // Inline JSX below: a nested component would get a fresh function
  // identity on every render, unmounting the slider mid-drag and dropping
  // pointer capture (track clicks still worked; thumb drags didn't).
  const legendTitle = colorByColumn ? colorSourceLegendLabel(colorSourceFromString(colorByColumn)) : "";
  const legend =
    colorMode === "continuous" && colorByColumn && colorRange ? (
      <ContinuousLegend
        title={legendTitle}
        colormap={legendState.colormapName}
        reversed={legendState.colormapReversed}
        vmin={userVmin ?? colorRange[0]}
        vmax={userVmax ?? colorRange[1]}
        absoluteVmin={colorRange[0]}
        absoluteVmax={colorRange[1]}
        onResetRange={() => {
          setUserVmin(undefined);
          setUserVmax(undefined);
        }}
        onRangeChange={(vmin, vmax) => {
          setUserVmin(vmin);
          setUserVmax(vmax);
        }}
      />
    ) : colorMode === "categorical" && categoryMapping && !showLoading ? (
      <CategoricalLegend title={legendTitle} />
    ) : null;

  if (!axes) {
    return (
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden text-lg text-muted-foreground">
        {loadingKey ? `Loading ${loadingKey.replace(/^X_/, "")}…` : "No embedding loaded"}
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
          trajectoryPath={trajectoryPath}
          onGpuError={setGpuError}
          onReady={onGpuReady}
        />
      </ScatterDeviceLeaseProvider>
      {showLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/50 text-lg text-muted-foreground">
          Loading{loadingKey ? ` ${loadingKey.replace(/^X_/, "")}...` : "..."}
        </div>
      )}
      {errorMessage && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-4 text-center text-red-400 text-lg">
          {errorMessage}
        </div>
      )}
      <HighlightFocusOverlay
        ref={highlightOverlayRef}
        worldPos={highlightWorldPos}
        containerRef={containerRef}
        gpuRef={gpuAdapter}
      />
      {renderOverlays({ legend, selection })}
    </div>
  );
}
