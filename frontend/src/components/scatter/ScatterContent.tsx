/**
 * ScatterContent — generic scatter panel content, decoupled from any container.
 *
 * Works identically in:
 *  - A Dockview tiled panel (ScatterPanel wraps it)
 *  - A FloatingWindow (FloatingScatterItem wraps it)
 *  - Any future container
 */

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useFloatingWindow } from "../../hooks/useFloatingWindow";
import { FloatingWindow } from "../FloatingWindow";
import { useThrottler } from "@tanstack/react-pacer";
import { ScatterGPUHost, type ScatterGPUHostHandle } from "../../scatter-gpu/components/ScatterGPUHost";
import type { ScatterplotConfig } from "../../scatter-gpu/types";
import type { PanelId } from "../../scatter-gpu/types";
import { selectionSyncStore } from "../../providers/SelectionSyncStore";
import { getBitmapRowIds, disposeBitmap } from "../../providers/RoaringBroadcastStore";
import { useScatterBrushSync } from "../../scatter-gpu/hooks/useScatterBrushSync";
import { useIsolationBridge } from "../../scatter-gpu/hooks/useIsolationBridge";
import type { IsolationCapability } from "../../scatter-gpu/handle-capabilities";
import { useTrajectoryLoader } from "../../scatter-gpu/hooks/useTrajectoryLoader";
import { viewSyncStore, broadcastViewState } from "../../providers/ViewSyncStore";
import { broadcastPanelState, clearPanelState } from "../../providers/PanelStateStore";
import { useMosaicScatterData } from "../../scatter-gpu/hooks/useMosaicScatterData";
import type { ColorMode } from "../../scatter-gpu/hooks/useMosaicScatterData";
import type { TrajectoryOverlaySvgHandle } from "./TrajectoryOverlaySvg";
import { TrajectoryOverlaySvg } from "./TrajectoryOverlaySvg";
import { ContinuousLegend } from "./ContinuousLegend";
import { CategoricalLegend } from "./CategoricalLegend";
import { LegendProvider, useEffectiveCategoryColors } from "./LegendContext";
import { ScatterOverlayControls } from "./ScatterOverlayControls";
import { useDashboard } from "../../hooks/useDashboard";
import { useScatterUIDispatch } from "../../providers/ScatterUIStateProvider";
import { useEmbeddingLoader } from "../../hooks/useEmbeddingLoader";
import { type CategoryMapping } from "../../lib/category-column";
import { toRows } from "../../lib/mosaic-helpers";
import { setBrushPredicate } from "../../providers/BrushPredicateStore";
import { useScatterColorState } from "../../scatter-gpu/hooks/useScatterColorState";
import { hexToRgbPalette } from "../../scatter-gpu/utils/colors";
import { colorSourceFromString, colorSourceLegendLabel, colorSourceToString } from "../../lib/color-source";
import type { AxisState, TrajectoryData, Metadata } from "../../types";
import type { DockviewPanelApi } from "dockview-react";
import type { Coordinator } from "@uwdata/mosaic-core";
import type { DashboardActions } from "../../dashboard/DashboardContext";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ScatterContentProps {
  panelId: PanelId;
  initialObsmKey?: string | null;
  initialColorByColumn?: string | null;
  /** Dockview panel API — undefined for floating panels */
  panelApi?: DockviewPanelApi;
  /** When set, axes are controlled externally (panel sync) */
  syncedAxes?: AxisState | null;
}

// ── ScatterContent ────────────────────────────────────────────────────────────

export function ScatterContent({
  panelId: myPanelId,
  initialObsmKey,
  initialColorByColumn: _initialColorByColumn,
  panelApi,
  syncedAxes,
}: ScatterContentProps) {
  const { state, actions, meta } = useDashboard();
  const { metadata, trajectory } = state;
  const { coordinator, brushSelection, table } = meta;

  // ── Embedding state ────────────────────────────────────────────────────────
  const [axes, setAxes] = useState<AxisState | null>(null);
  const { loadEmbedding, loadingKey } = useEmbeddingLoader(metadata, actions.refreshMetadata);

  // Use synced axes when provided (cross-panel link mode)
  const effectiveAxes = syncedAxes !== undefined ? syncedAxes : axes;

  useEffect(() => {
    if (axes || !metadata) return;
    const key = initialObsmKey ?? Object.entries(metadata.obsm).find(([, v]) => v.loaded)?.[0];
    if (!key) return;
    const entry = metadata.obsm[key];
    if (entry && !entry.loaded) {
      loadEmbedding(key).then(() => setAxes({ obsmKey: key, xDim: 0, yDim: 1 }));
    } else {
      setAxes({ obsmKey: key, xDim: 0, yDim: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata, axes, initialObsmKey]);

  const handleSetAxes = async (newAxes: AxisState) => {
    const entry = metadata.obsm[newAxes.obsmKey];
    if (entry && !entry.loaded) await loadEmbedding(newAxes.obsmKey);
    setAxes(newAxes);
  };

  // ── Selection tool ─────────────────────────────────────────────────────────
  const [selectionTool, setSelectionTool] = useState<"pan" | "marquee" | "lasso">("pan");

  // ── Color state ────────────────────────────────────────────────────────────
  const {
    colorByColumn,
    setColorByColumn: _setColorByColumn,
    colorSource,
    setColorSource,
    obsColumns,
    colorMode,
    setColorModeOverride,
    colorModeInfo,
    categoricalColormap: _categoricalColormap,
    setCategoricalColormap: _setCategoricalColormap,
    continuousColormap,
    setContinuousColormap: _setContinuousColormap,
    maxCategories: _maxCategories,
    setMaxCategories: _setMaxCategories,
    categoricalColormaps: _categoricalColormaps,
    continuousColormaps: _continuousColormaps,
    categoryLoading,
    coloredCategoryMapping,
    categoryCol,
  } = useScatterColorState(coordinator, metadata);

  // ── Isolation → Mosaic cross-filter + GPU alpha dimming ───────────────────
  // Both refs are synced by ScatterView after its GPU host and data are ready.
  const isolationHandleRef = useRef<IsolationCapability | null>(null);
  const categoryIndicesRef = useRef<Uint8Array | null>(null);
  const fitViewRef = useRef<(() => void) | null>(null);
  const { handleIsolationChange } = useIsolationBridge({
    coloredCategoryMapping,
    colorByColumn,
    scatterRef: isolationHandleRef,
    categoryIndicesRef,
  });

  // ── Derived rendering state ────────────────────────────────────────────────
  const obsmKeys = effectiveAxes ? Object.keys(metadata.obsm) : [];
  const currentEntry = effectiveAxes ? metadata.obsm[effectiveAxes.obsmKey] : null;
  const dims = Array.from({ length: currentEntry?.n_dims ?? 0 }, (_, i) => i);
  const prefix = currentEntry?.prefix ?? "x";
  const xCol = effectiveAxes ? `${prefix}_${effectiveAxes.xDim}` : "";
  const yCol = effectiveAxes ? `${prefix}_${effectiveAxes.yDim}` : "";

  const isLoading = !!loadingKey || categoryLoading;
  const floatingWindow = useFloatingWindow({ initialWidth: 480, initialHeight: 480 });

  // ── Broadcast panel state for cross-panel sync ─────────────────────────────
  useEffect(() => {
    broadcastPanelState(String(myPanelId), { axes: effectiveAxes, colorByColumn: colorSourceToString(colorSource) });
  }, [myPanelId, effectiveAxes, colorByColumn]);

  useEffect(() => {
    return () => {
      clearPanelState(String(myPanelId));
      disposeBitmap(String(myPanelId) as PanelId);
    };
  }, [myPanelId]);

  // Shared ScatterView props
  const scatterViewProps = {
    myPanelId,
    selectionTool,
    axes: effectiveAxes,
    isLoading,
    loadingKey,
    coordinator,
    table,
    xCol,
    yCol,
    colorMode,
    categoryCol,
    categoryMapping: coloredCategoryMapping,
    colorByColumn,
    continuousColormap,
    trajectory,
    metadata,
    actions,
    isolationHandleRef,
    categoryIndicesRef,
    fitViewRef,
  };

  const overlayControls = effectiveAxes ? (
    <ScatterOverlayControls
      axes={effectiveAxes}
      obsmKeys={obsmKeys}
      dims={dims}
      loadingKey={loadingKey}
      currentEntryLoaded={!!currentEntry?.loaded}
      colorSource={colorSource}
      obsColumns={obsColumns}
      colorMode={colorMode}
      colorModeCanToggle={colorModeInfo.canToggle}
      hasVar={(metadata.var_count ?? 0) > 0}
      onSetAxes={handleSetAxes}
      onSetColorSource={setColorSource}
      onToggleColorMode={() => setColorModeOverride(colorMode === "continuous" ? "categorical" : "continuous")}
      selectionTool={selectionTool}
      onSetSelectionTool={setSelectionTool}
      onFitView={() => fitViewRef.current?.()}
      floatingWindow={floatingWindow}
      panelApi={panelApi}
    />
  ) : null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <LegendProvider
        categoryMapping={coloredCategoryMapping}
        coordinator={coordinator}
        selection={brushSelection}
        table={table}
        categoryCol={categoryCol}
        onIsolationChange={handleIsolationChange}
      >
        <ScatterView {...scatterViewProps} overlayControls={overlayControls} />
      </LegendProvider>

      {/* Nested in-app PiP floating window */}
      <FloatingWindow
        handle={floatingWindow}
        title={
          effectiveAxes
            ? `${effectiveAxes.obsmKey.replace(/^X_/, "")} · x:${effectiveAxes.xDim} y:${effectiveAxes.yDim}`
            : "Scatter"
        }
      >
        <LegendProvider
          categoryMapping={coloredCategoryMapping}
          coordinator={coordinator}
          selection={brushSelection}
          table={table}
          categoryCol={categoryCol}
          onIsolationChange={handleIsolationChange}
        >
          <ScatterView {...scatterViewProps} overlayControls={overlayControls} />
        </LegendProvider>
      </FloatingWindow>
    </div>
  );
}

// ── Inner ScatterView ─────────────────────────────────────────────────────────

interface ScatterViewProps {
  myPanelId: PanelId;
  selectionTool: "pan" | "marquee" | "lasso";
  isolationHandleRef?: RefObject<{
    setCategoryIsolation(s: Set<number>, c: Uint8Array): void;
    clearCategoryIsolation(): void;
  } | null>;
  categoryIndicesRef?: RefObject<Uint8Array | null>;
  fitViewRef?: RefObject<(() => void) | null>;
  overlayControls?: ReactNode;
  axes: AxisState | null;
  isLoading: boolean;
  loadingKey: string | null;
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
  metadata: Metadata;
  actions: DashboardActions;
}

function ScatterView({
  myPanelId,
  selectionTool,
  axes,
  isLoading,
  loadingKey,
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
  metadata,
  actions,
  overlayControls,
  isolationHandleRef,
  categoryIndicesRef,
  fitViewRef,
}: ScatterViewProps) {
  const categoryColors = useEffectiveCategoryColors();
  const { setFps, setZoom, setSelection, setEmbedding, setNumPoints } = useScatterUIDispatch();

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
  const rowIndicesRef = useRef<number[]>([]);
  const [gpuError, setGpuError] = useState<string | null>(null);

  // ── Continuous range filter handles (dim-only — colormap is NOT remapped) ──
  const [userVmin, setUserVmin] = useState<number | undefined>(undefined);
  const [userVmax, setUserVmax] = useState<number | undefined>(undefined);
  // Stable source identity for setBrushPredicate — one per ScatterView instance
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
    continuousColormap,
    // vmin/vmax intentionally NOT passed — colormap stays fixed at full data range;
    // the slider only controls which points are dimmed via GPU isolation mask.
  });

  // Continuous range isolation — dim points + update Mosaic cross-filter.
  // Debounced 80ms so rapid slider moves don't hammer DuckDB.
  useEffect(() => {
    const source = rangeFilterSourceRef.current;
    if (colorMode !== "continuous" || !colorByColumn || userVmin === undefined || userVmax === undefined) {
      hostRef.current?.clearRowIsolation();
      setBrushPredicate(source, null);
      return;
    }
    const col = colorByColumn;
    const vmin = userVmin;
    const vmax = userVmax;
    // Update Mosaic cross-filter so exports + table reflect the range
    setBrushPredicate(source, `"${col}" >= ${vmin} AND "${col}" <= ${vmax}`);
    let cancelled = false;
    const tid = setTimeout(() => {
      coordinator
        .query(`SELECT __row_index__ FROM obs_base WHERE "${col}" >= ${vmin} AND "${col}" <= ${vmax}`, { type: "json" })
        .then((result: unknown) => {
          if (cancelled) return;
          const indices = toRows<{ __row_index__: number }>(result).map((r) => r.__row_index__);
          hostRef.current?.setRowIsolation(indices);
        })
        .catch(() => {
          if (!cancelled) hostRef.current?.clearRowIsolation();
        });
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(tid);
    };
    // coordinator is a stable singleton per DashboardProvider session — safe to omit from deps.
    // If it ever becomes unstable, replace with coordinatorRef.current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, colorByColumn, userVmin, userVmax]);

  // ── Fit-view: pan+zoom to show the full embedding bounding box ──────────────
  const handleFitView = useCallback(() => {
    const positions = data?.positions;
    const el = containerRef.current;
    if (!positions || positions.length < 2 || !el) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 2) {
      const x = positions[i], y = positions[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!isFinite(minX) || minX === maxX || minY === maxY) return;
    const aspect = el.clientWidth / el.clientHeight || 1;
    const padding = 0.88;
    const zoom = Math.min(
      (2 * padding) / (maxY - minY),
      (2 * aspect * padding) / (maxX - minX),
    );
    hostRef.current?.setViewState({
      panX: -(minX + maxX) / 2,
      panY: -(minY + maxY) / 2,
      zoom,
    });
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
  });

  const callbacksRef = useRef({
    onSelectionChange: (_count: number | null, _indices?: number[]) => {},
    onExternalClear: () => {},
    onPointClick: (_index: number, _pos: [number, number], _catIdx: number, _catName: string) => {},
    onViewChange: (_state: { panX: number; panY: number; zoom: number }) => {},
    onFps: (_fps: number) => {},
  });

  callbacksRef.current.onSelectionChange = onSelectionChange;
  callbacksRef.current.onExternalClear = () => setSelection(null);
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
      onViewChange: (...args) => callbacksRef.current.onViewChange(...args),
      onFps: (...args) => callbacksRef.current.onFps(...args),
    },
  });

  const paletteRef = useRef<readonly (readonly [number, number, number])[]>([]);

  useEffect(() => {
    if (colorMode !== "categorical") return;
    const colors = categoryColors ?? [];
    if (colors.length === 0 || colors.some((c) => !c)) return;
    const palette = hexToRgbPalette(colors);
    paletteRef.current = palette;
    hostRef.current?.setColors(palette, data?.categoryIndices);
  }, [categoryColors, colorMode, data?.categoryIndices]);

  useEffect(() => {
    if (colorMode !== "continuous" || !data?.colorValues) return;
    hostRef.current?.setColorsDirect(data.colorValues);
  }, [data?.colorValues, colorMode]);

  useEffect(() => {
    const sub = selectionSyncStore.subscribe(() => {
      const s = selectionSyncStore.state;
      if (s.type === "empty") {
        if (s.sourcePanelId === myPanelId) return;
        hostRef.current?.clearExternalSelection();
      } else {
        if (s.sourcePanelId === myPanelId) return;
        hostRef.current?.setExternalSelection(getBitmapRowIds(s.sourcePanelId));
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

  const axesKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = axes ? `${axes.obsmKey}:${axes.xDim}:${axes.yDim}` : null;
    const changed = axesKeyRef.current !== null && key !== axesKeyRef.current;
    axesKeyRef.current = key;
    if (changed) actions.setTrajectory(null);
    setEmbedding(axes?.obsmKey ?? null);
  }, [axes, actions, setEmbedding]);

  const { activeIndex } = useTrajectoryLoader({
    coordinator,
    table,
    xCol,
    yCol,
    categoryCol,
    metadata,
  });

  const showLoading = isLoading || dataLoading;

  if (!axes) {
    return (
      <div className="relative min-h-0 flex-1 overflow-hidden flex items-center justify-center text-sm text-text-muted">
        No embedding loaded
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative min-h-0 flex-1 overflow-hidden${trajectory ? " trajectory-active" : ""}`}
    >
      <ScatterGPUHost
        ref={hostRef}
        data={data}
        positionKey={positionKey}
        config={configRef.current}
        onGpuError={setGpuError}
        onRowIndicesChange={(indices) => {
          rowIndicesRef.current = indices;
          setNumPoints(indices.length);
        }}
      />
      {showLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-text-muted bg-base/50 pointer-events-none">
          Loading{loadingKey ? ` ${loadingKey.replace(/^X_/, "")}...` : "..."}
        </div>
      )}
      {gpuError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-red-400 p-4 text-center bg-base/80">
          {gpuError}
        </div>
      )}
      {trajectory ? (
        <TrajectoryOverlaySvg
          ref={trajectoryOverlayRef}
          points={trajectory.points}
          activeIndex={activeIndex}
          categoryColors={categoryColors ?? []}
          containerRef={containerRef}
          gpuRef={gpuAdapter}
        />
      ) : null}
      {overlayControls}
      {colorMode === "categorical" && categoryMapping && !showLoading ? <CategoricalLegend /> : null}
      {colorMode === "continuous" && colorByColumn && colorRange ? (
        <ContinuousLegend
          columnName={colorSourceLegendLabel(colorSourceFromString(colorByColumn))}
          colormap={continuousColormap}
          vmin={userVmin ?? colorRange[0]}
          vmax={userVmax ?? colorRange[1]}
          absoluteVmin={colorRange[0]}
          absoluteVmax={colorRange[1]}
          onRangeChange={(vmin, vmax) => {
            setUserVmin(vmin);
            setUserVmax(vmax);
          }}
        />
      ) : null}
    </div>
  );
}
