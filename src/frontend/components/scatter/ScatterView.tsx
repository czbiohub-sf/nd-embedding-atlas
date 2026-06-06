/**
 * ScatterView — inner GPU rendering layer for a single scatter panel.
 *
 * Owns all WebGPU state: positions, colors, selection sync, view sync,
 * trajectory overlay, continuous range filter, and legend binding.
 * Rendered inside a LegendProvider by ScatterContent.
 */

import { useThrottler } from "@tanstack/react-pacer";
import type { Coordinator } from "@uwdata/mosaic-core";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { DashboardActions } from "../../dashboard/DashboardContext";
import type { CategoryMapping } from "../../lib/category-column";
import { colorSourceFromString, colorSourceLegendLabel } from "../../lib/color-source";
import { toRows } from "../../lib/mosaic-helpers";
import { ScatterGPUHost, type ScatterGPUHostHandle } from "../../scatter-gpu/components/ScatterGPUHost";
import { GpuDeviceProvider } from "../../core/gpu/gpu-device-context";
import { type ColorMode, useMosaicScatterData } from "../../scatter-gpu/hooks/useMosaicScatterData";
import { useScatterBrushSync } from "../../scatter-gpu/hooks/useScatterBrushSync";
import type { PanelId, ScatterplotConfig } from "../../scatter-gpu/types";
import { hexToRgbPalette } from "../../scatter-gpu/utils/colors";
import { buildColormapLut } from "../../lib/ochre-lut";
import { setBrushPredicate } from "../../stores/BrushPredicateStore";
import { pointRadiusStore } from "../../stores/PointRadiusStore";
import { renderSettingsStore } from "../../stores/RenderSettingsStore";
import { getBitmapRowIds } from "../../stores/RoaringBroadcastStore";
import { activeCollectionStore, setActiveCollection } from "../../stores/ActiveCollectionStore";
import { selectionSyncStore } from "../../stores/SelectionSyncStore";
import { broadcastViewState, viewSyncStore } from "../../stores/ViewSyncStore";
import type { AxisState, Metadata, TrajectoryData } from "../../types";
import { CategoricalLegend } from "./CategoricalLegend";
import { ContinuousLegend } from "./ContinuousLegend";
import { useEffectiveCategoryColors, useLegend } from "./LegendContext";
import { useScatterUIDispatch } from "./ScatterUIStateProvider";
import type { TrajectoryOverlaySvgHandle } from "./TrajectoryOverlaySvg";
import { TrajectoryOverlaySvg } from "./TrajectoryOverlaySvg";

export interface ScatterViewProps {
  myPanelId: PanelId;
  selectionTool: "pan" | "marquee" | "lasso";
  isolationHandleRef?: RefObject<{
    setCategoryIsolation(s: Set<number>, c: Uint8Array): void;
    clearCategoryIsolation(): void;
  } | null>;
  categoryIndicesRef?: RefObject<Uint8Array | null>;
  fitViewRef?: RefObject<(() => void) | null>;
  /** Hoisted ref — populated by ScatterView but owned by ScatterContent */
  rowIndicesRef?: RefObject<number[]>;
  /** Called when GPU readback updates the row index list */
  onRowIndicesChange?: (indices: number[]) => void;
  /** Out-ref populated with the *lasso* row IDs (subset of rowIndicesRef). */
  lassoRowIdsRef?: RefObject<number[]>;
  overlayControls?: ReactNode;
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
  actions: DashboardActions;
  highlightId: string | null;
}

export function ScatterView({
  myPanelId,
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
  highlightId,
  overlayControls,
  isolationHandleRef,
  categoryIndicesRef,
  fitViewRef,
  rowIndicesRef: externalRowIndicesRef,
  onRowIndicesChange,
  lassoRowIdsRef,
}: ScatterViewProps) {
  const categoryColors = useEffectiveCategoryColors();
  const { setFps, setZoom, setSelection, setEmbedding, setNumPoints } = useScatterUIDispatch();

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
  const gpuAdapter = useRef({
    worldToScreen: (wx: number, wy: number, w: number, h: number) =>
      hostRef.current?.worldToScreen(wx, wy, w, h) ?? { x: 0, y: 0 },
  });

  const viewStateRef = useRef({ panX: 0, panY: 0, zoom: 1 });
  const _localRowIndicesRef = useRef<number[]>([]);
  const rowIndicesRef = externalRowIndicesRef ?? _localRowIndicesRef;
  const [gpuError, setGpuError] = useState<string | null>(null);

  // ── Continuous range filter handles (dim-only — colormap is NOT remapped) ──
  const [userVmin, setUserVmin] = useState<number | undefined>();
  const [userVmax, setUserVmax] = useState<number | undefined>();
  const rangeFilterSourceRef = useRef<object>({});

  // Reset filter when column changes
  useEffect(() => {
    setUserVmin(undefined);
    setUserVmax(undefined);
    setBrushPredicate(rangeFilterSourceRef.current, null);
  }, [colorByColumn]);

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
    // vmin/vmax intentionally NOT passed — colormap stays fixed at full data range;
    // the slider only controls which points are dimmed via GPU isolation mask.
  });

  // Trajectory isolation — each feature owns its own mask; no mutual exclusion needed.
  // Also highlights trajectory points so they render at full brightness (tier 2).
  useEffect(() => {
    if (activeTrajectories.length === 0) {
      hostRef.current?.clearTrajectoryIsolation();
      return () => {};
    }
    const rowIndices = activeTrajectories.flatMap((t) =>
      t.points.map((p) => p.rowIndex).filter((id): id is number => id != null),
    );
    if (rowIndices.length > 0) {
      hostRef.current?.setTrajectoryIsolation(rowIndices);
      hostRef.current?.setHighlightPoints(rowIndices);
    }
    return () => {
      hostRef.current?.clearTrajectoryIsolation();
      hostRef.current?.clearHighlight();
    };
  }, [activeTrajectories]);

  // Continuous range isolation — independent mask; no trajectory guards needed.
  useEffect(() => {
    const source = rangeFilterSourceRef.current;
    if (colorMode !== "continuous" || !colorByColumn || userVmin === undefined || userVmax === undefined) {
      hostRef.current?.clearContinuousIsolation();
      setBrushPredicate(source, null);
      return () => {};
    }
    const col = colorByColumn;
    const vmin = userVmin;
    const vmax = userVmax;
    setBrushPredicate(source, `"${col}" >= ${vmin} AND "${col}" <= ${vmax}`);
    let cancelled = false;
    const tid = setTimeout(() => {
      coordinator
        .query(`SELECT __row_index__ FROM dataset WHERE "${col}" >= ${vmin} AND "${col}" <= ${vmax}`, {
          type: "json",
        })
        .then((result: unknown) => {
          if (cancelled) return;
          const indices = toRows<{ __row_index__: number }>(result).map((r) => r.__row_index__);
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
  }, [colorMode, colorByColumn, userVmin, userVmax, coordinator]);

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
      if (viewSyncStore.state.lockMode === "linked") broadcastViewState(myPanelId, vs);
    },
    { wait: 16 },
  );

  const { onSelectionChange } = useScatterBrushSync({
    myPanelId,
    rowIndicesRef,
    setSelection,
    lassoRowIdsRef,
  });

  const callbacksRef = useRef({
    onSelectionChange: (_count: number | null, _indices?: number[]) => {},
    onExternalClear: () => {},
    onPointClick: (_index: number, _pos: [number, number], _catIdx: number, _catName: string) => {},
    onBackgroundClick: () => {},
    onViewChange: (_state: { panX: number; panY: number; zoom: number }) => {},
    onFps: (_fps: number) => {},
  });

  const hasLassoRef = useRef(false);
  callbacksRef.current.onSelectionChange = (...args) => {
    hasLassoRef.current = args[0] != null && args[0] > 0;
    onSelectionChange(...args);
  };
  callbacksRef.current.onExternalClear = () => setSelection(null);
  callbacksRef.current.onBackgroundClick = () => {
    actions.setHighlight(null);
  };
  callbacksRef.current.onPointClick = (index) => {
    const rowIdx = rowIndicesRef.current[index] ?? index;
    actions.setHighlight(String(rowIdx));
  };
  callbacksRef.current.onViewChange = (state) => {
    viewStateRef.current = state;
    setZoom(state.zoom);
    trajectoryOverlayRef.current?.update();
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
    // Point radius
    hostRef.current?.setPointRadius(pointRadiusStore.state.radius);
    // Point opacity — re-applied on GPU reinit so it survives data swaps
    hostRef.current?.setPointOpacity(renderSettingsStore.state.pointOpacity);
    // Blend mode — re-applied on GPU reinit
    hostRef.current?.setBlendMode(renderSettingsStore.state.blendMode);
    // HDR settings — re-applied on GPU reinit
    {
      const s = renderSettingsStore.state;
      hostRef.current?.setHdrSettings({
        toneMapping: s.toneMapping,
        exposure: s.exposure,
      });
    }
    // Selection tool
    hostRef.current?.setForcedSelectionMode(selectionTool);
    // Re-upload all isolation masks from CPU state after GPU reinit
    hostRef.current?.rehydrateIsolation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionKey]); // intentionally only positionKey — this runs once per GPU init

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

  useEffect(() => {
    const sub = selectionSyncStore.subscribe(() => {
      const s = selectionSyncStore.state;
      const isSelf = s.source?.kind === "panel" && s.source.panelId === myPanelId;
      if (s.type === "empty") {
        if (isSelf) return;
        hostRef.current?.clearExternalSelection();
      } else {
        if (isSelf) return;
        hostRef.current?.setExternalSelection(getBitmapRowIds(s.source));
      }
    });
    return () => sub.unsubscribe();
  }, [myPanelId]);

  useEffect(() => {
    const sub = viewSyncStore.subscribe(() => {
      const s = viewSyncStore.state;
      if (s.lockMode !== "linked" || s.sourcePanelId === myPanelId) return;
      hostRef.current?.setViewState({ panX: s.panX, panY: s.panY, zoom: s.zoom });
    });
    return () => sub.unsubscribe();
  }, [myPanelId]);

  // Sync global point radius to this panel's GPU instance
  useEffect(() => {
    const sub = pointRadiusStore.subscribe(() => {
      hostRef.current?.setPointRadius(pointRadiusStore.state.radius);
    });
    return () => sub.unsubscribe();
  }, []);

  // Sync global point opacity + blend mode + HDR settings to this panel's
  // GPU instance. Single subscription — we always re-apply on any change
  // to keep the GPU in lockstep with the store.
  useEffect(() => {
    const sub = renderSettingsStore.subscribe(() => {
      const s = renderSettingsStore.state;
      hostRef.current?.setPointOpacity(s.pointOpacity);
      hostRef.current?.setBlendMode(s.blendMode);
      hostRef.current?.setHdrSettings({
        toneMapping: s.toneMapping,
        exposure: s.exposure,
      });
    });
    return () => sub.unsubscribe();
  }, []);

  // Clear GPU highlight when highlightId becomes null (escape, background click, etc.)
  useEffect(() => {
    if (!highlightId) {
      hostRef.current?.clearHighlight();
    }
  }, [highlightId]);

  // Escape cascade: highlight → trajectory → lasso → active collection
  //                                              → (category handled by CategoricalLegend)
  // Active collection sits between lasso and category because:
  //   - lasso-in-progress is the most recent transient state
  //   - active collection is the persistent scope; the user wants Esc to
  //     drop the scope only after they've already cleared a lasso within it
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (highlightId) {
        actions.setHighlight(null);
      } else if (trajectory) {
        actions.clearTrajectory(trajectory.datasetKey ?? "");
      } else if (hasLassoRef.current) {
        hostRef.current?.clearSelection();
        setSelection(null);
        hasLassoRef.current = false;
      } else if (activeCollectionStore.state.activeId !== null) {
        setActiveCollection(null);
      } else {
        return; // let event propagate to CategoricalLegend's Escape handler
      }
      e.stopPropagation();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [highlightId, trajectory, actions, setSelection]);

  // Listen for global "clear lasso" requests (e.g. fired by the
  // collections bridge when a collection is activated — collection becomes
  // the new working scope and any prior lasso is reset).
  useEffect(() => {
    const handler = () => {
      if (!hasLassoRef.current) return;
      hostRef.current?.clearSelection();
      setSelection(null);
      hasLassoRef.current = false;
    };
    window.addEventListener("ndea:clear-lasso", handler);
    return () => window.removeEventListener("ndea:clear-lasso", handler);
  }, [setSelection]);

  const axesKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = axes ? `${axes.obsmKey}:${axes.xDim}:${axes.yDim}` : null;
    const changed = axesKeyRef.current != null && key !== axesKeyRef.current;
    axesKeyRef.current = key;
    if (changed) actions.clearTrajectory(trajectory?.datasetKey ?? "");
    setEmbedding(axes?.obsmKey ?? null);
  }, [axes, actions, setEmbedding, trajectory]);

  useEffect(() => {
    if (!highlightId && trajectory) actions.clearTrajectory(trajectory.datasetKey ?? "");
  }, [highlightId, trajectory, actions]);

  const showLoading = isLoading || dataLoading;

  // Inline JSX below — a nested component would get a fresh function
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
      {/* GpuDeviceProvider sits BELOW the `!axes` guard above, so an empty scatter
          acquires zero device. With a host on context (docked path) the GPU host
          waits for its lease; without one (floating path) it self-acquires. */}
      <GpuDeviceProvider>
        <ScatterGPUHost
          ref={hostRef}
          data={data}
          positionKey={positionKey}
          config={configRef.current}
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
      {overlayControls}
      {colorMode === "categorical" && categoryMapping && !showLoading ? <CategoricalLegend /> : null}
      {continuousLegend}
    </div>
  );
}
