import type { IDockviewPanelProps } from "dockview-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useThrottler } from "@tanstack/react-pacer";
import { ScatterGPUHost, type ScatterGPUHostHandle } from "../../../scatter-gpu/components/ScatterGPUHost";
import type { ScatterplotConfig } from "../../../scatter-gpu/types";
import { panelId } from "../../../scatter-gpu/types";
import { selectionSyncStore } from "../../../providers/SelectionSyncStore";
import { useScatterBrushSync } from "../../../scatter-gpu/hooks/useScatterBrushSync";
import { useIsolationBridge } from "../../../scatter-gpu/hooks/useIsolationBridge";
import { useTrajectoryLoader } from "../../../scatter-gpu/hooks/useTrajectoryLoader";
import { viewSyncStore, broadcastViewState } from "../../../providers/ViewSyncStore";
import { useMosaicScatterData } from "../../../scatter-gpu/hooks/useMosaicScatterData";
import type { ColorMode } from "../../../scatter-gpu/hooks/useMosaicScatterData";
import type { TrajectoryOverlaySvgHandle } from "../../scatter/TrajectoryOverlaySvg";
import { TrajectoryOverlaySvg } from "../../scatter/TrajectoryOverlaySvg";
import { ContinuousLegend } from "../../scatter/ContinuousLegend";
import { CategoricalLegend } from "../../scatter/CategoricalLegend";
import { LegendProvider, useEffectiveCategoryColors } from "../../scatter/LegendContext";
import { PointInfoPane } from "../../scatter/PointInfoPane";
import { ScatterControlStrip } from "../../scatter/ScatterControlStrip";
import { useDashboard } from "../../../hooks/useDashboard";
import { useScatterUIDispatch } from "../../../providers/ScatterUIStateProvider";
import { useEmbeddingLoader } from "../../../hooks/useEmbeddingLoader";
import { type CategoryMapping } from "../../../lib/category-column";
import { useScatterColorState } from "../../../scatter-gpu/hooks/useScatterColorState";
import type { AxisState } from "../../../types";
import type { PanelId } from "../../../scatter-gpu/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgbPalette(hexColors: string[]): readonly (readonly [number, number, number])[] {
  return hexColors.map((hex) => {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ] as const;
  });
}

// ── Outer panel ───────────────────────────────────────────────────────────────

export function ScatterPanel(props: IDockviewPanelProps) {
  const myPanelId = panelId(props.api.id);
  const initialObsmKey = (props.params as { initialObsmKey?: string } | undefined)?.initialObsmKey ?? null;
  const { state, actions, meta } = useDashboard();
  const { metadata, trajectory } = state;
  const { coordinator, brushSelection, table } = meta;

  // ── Per-panel embedding state ──────────────────────────────────────────────
  const [axes, setAxes] = useState<AxisState | null>(null);
  const { loadEmbedding, loadingKey } = useEmbeddingLoader(metadata, actions.refreshMetadata);

  // Initialize: prefer initialObsmKey from panel params, then first loaded embedding.
  // If the target embedding isn't loaded yet, trigger loadEmbedding first.
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
  }, [metadata, axes, initialObsmKey]); // loadEmbedding is stable (useCallback)

  const handleSetAxes = async (newAxes: AxisState) => {
    const entry = metadata.obsm[newAxes.obsmKey];
    if (entry && !entry.loaded) {
      await loadEmbedding(newAxes.obsmKey);
    }
    setAxes(newAxes);
  };

  // ── Selection tool state ───────────────────────────────────────────────────
  const [selectionTool, setSelectionTool] = useState<"pan" | "marquee" | "lasso">("pan");

  // ── Color state ────────────────────────────────────────────────────────────
  const {
    colorByColumn,
    setColorByColumn,
    obsColumns,
    colorMode,
    setColorModeOverride,
    colorModeInfo,
    categoricalColormap,
    setCategoricalColormap,
    continuousColormap,
    setContinuousColormap,
    maxCategories,
    setMaxCategories,
    categoricalColormaps,
    continuousColormaps,
    categoryLoading,
    coloredCategoryMapping,
    categoryCol,
  } = useScatterColorState(coordinator, metadata);

  const additionalFields = useMemo(
    () => Object.fromEntries(["track_id", "fov_name", "t"].filter((f) => obsColumns.includes(f)).map((f) => [f, f])),
    [obsColumns],
  );

  // ── Isolation → Mosaic cross-filter (via BrushPredicateStore) ────────────
  const { handleIsolationChange } = useIsolationBridge({ coloredCategoryMapping, colorByColumn });

  // ── Derive rendering state ─────────────────────────────────────────────────
  const obsmKeys = axes ? Object.keys(metadata.obsm) : [];
  const currentEntry = axes ? metadata.obsm[axes.obsmKey] : null;
  const dims = Array.from({ length: currentEntry?.n_dims ?? 0 }, (_, i) => i);
  const prefix = currentEntry?.prefix ?? "x";
  const xCol = axes ? `${prefix}_${axes.xDim}` : "";
  const yCol = axes ? `${prefix}_${axes.yDim}` : "";

  const isLoading = !!loadingKey || categoryLoading;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-base">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      {axes ? (
        <ScatterControlStrip
          axes={axes}
          obsmKeys={obsmKeys}
          dims={dims}
          loadingKey={loadingKey}
          currentEntryLoaded={!!currentEntry?.loaded}
          colorByColumn={colorByColumn}
          obsColumns={obsColumns}
          colorMode={colorMode}
          colorModeCanToggle={colorModeInfo.canToggle}
          categoricalColormap={categoricalColormap}
          categoricalColormaps={categoricalColormaps}
          continuousColormap={continuousColormap}
          continuousColormaps={continuousColormaps}
          maxCategories={maxCategories}
          onSetAxes={handleSetAxes}
          onSetColorByColumn={setColorByColumn}
          onToggleColorMode={() => setColorModeOverride(colorMode === "continuous" ? "categorical" : "continuous")}
          onSetCategoricalColormap={setCategoricalColormap}
          onSetContinuousColormap={setContinuousColormap}
          onSetMaxCategories={setMaxCategories}
          selectionTool={selectionTool}
          onSetSelectionTool={setSelectionTool}
        />
      ) : null}

      {/* ── Scatter view (wrapped in LegendProvider) ─────────────────────── */}
      <LegendProvider
        categoryMapping={coloredCategoryMapping}
        coordinator={coordinator}
        selection={brushSelection}
        table={table}
        categoryCol={categoryCol}
        onIsolationChange={handleIsolationChange}
      >
        <ScatterView
          myPanelId={myPanelId}
          selectionTool={selectionTool}
          axes={axes}
          isLoading={isLoading}
          loadingKey={loadingKey}
          coordinator={coordinator}
          table={table}
          xCol={xCol}
          yCol={yCol}
          colorMode={colorMode}
          categoryCol={categoryCol}
          categoryMapping={coloredCategoryMapping}
          colorByColumn={colorByColumn}
          continuousColormap={continuousColormap}
          additionalFields={additionalFields}
          brushSelection={brushSelection}
          highlightId={state.highlightId}
          trajectory={trajectory}
          metadata={metadata}
          actions={actions}
        />
      </LegendProvider>
    </div>
  );
}

// ── Inner component ───────────────────────────────────────────────────────────

interface ScatterViewProps {
  myPanelId: PanelId;
  selectionTool: "pan" | "marquee" | "lasso";
  axes: AxisState | null;
  isLoading: boolean;
  loadingKey: string | null;
  coordinator: import("@uwdata/mosaic-core").Coordinator;
  table: string;
  xCol: string;
  yCol: string;
  colorMode: ColorMode;
  categoryCol: string | null;
  categoryMapping: CategoryMapping | null;
  colorByColumn: string | null;
  continuousColormap: string;
  additionalFields: Record<string, string>;
  brushSelection: import("@uwdata/mosaic-core").Selection;
  highlightId: string | null;
  trajectory: import("../../../types").TrajectoryData | null;
  metadata: import("../../../types").Metadata;
  actions: import("../../../dashboard/DashboardContext").DashboardActions;
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
  additionalFields,
  brushSelection,
  highlightId,
  trajectory,
  metadata,
  actions,
}: ScatterViewProps) {
  const categoryColors = useEffectiveCategoryColors();
  const { setFps, setZoom, setSelection, setEmbedding, setNumPoints } = useScatterUIDispatch();

  // ── Refs ──────────────────────────────────────────────────────────────────
  const hostRef = useRef<ScatterGPUHostHandle | null>(null);

  // Sync toolbar selection tool to the GPU interaction controller
  useEffect(() => {
    hostRef.current?.setForcedSelectionMode(selectionTool);
  }, [selectionTool]);

  const containerRef = useRef<HTMLDivElement>(null);
  const trajectoryOverlayRef = useRef<TrajectoryOverlaySvgHandle | null>(null);
  // Adapter so TrajectoryOverlaySvg can call worldToScreen via hostRef
  const gpuAdapter = useRef({
    worldToScreen: (wx: number, wy: number, w: number, h: number) =>
      hostRef.current?.worldToScreen(wx, wy, w, h) ?? { x: 0, y: 0 },
  });

  // ── State refs (no re-render on change) ───────────────────────────────────
  const viewStateRef = useRef({ panX: 0, panY: 0, zoom: 1 });
  const rowIndicesRef = useRef<number[]>([]);
  const [gpuError, setGpuError] = useState<string | null>(null);

  // ── Data from Mosaic binary endpoints ─────────────────────────────────────
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
  });

  // ── Throttled view-state broadcast (~60fps) ───────────────────────────────
  const viewBroadcaster = useThrottler(
    (vs: { panX: number; panY: number; zoom: number }) => {
      if (viewSyncStore.state.lockMode === "linked") broadcastViewState(myPanelId, vs);
    },
    { wait: 16 },
  );

  // ── Brush sync (throttler + debouncer + selection broadcast) ─────────────
  const { onSelectionChange } = useScatterBrushSync({
    brushSelection,
    myPanelId,
    rowIndicesRef,
    setSelection,
  });

  // ── Stable callbacks ref — GPU config never changes identity ──────────────
  const callbacksRef = useRef({
    onSelectionChange: (_count: number | null, _indices?: number[]) => {},
    onExternalClear: () => {},
    onPointClick: (_index: number, _pos: [number, number], _catIdx: number, _catName: string) => {},
    onViewChange: (_state: { panX: number; panY: number; zoom: number }) => {},
    onFps: (_fps: number) => {},
  });

  // Update callbacks each render without recreating config
  callbacksRef.current.onSelectionChange = onSelectionChange;

  // External clear: another panel cleared its selection. Only update the status bar —
  // must NOT call clearSelectionSync here or a ping-pong cascade fires between panels.
  callbacksRef.current.onExternalClear = () => setSelection(null);

  callbacksRef.current.onPointClick = (index) => {
    const rowIdx = rowIndicesRef.current[index] ?? index;
    actions.setHighlight(String(rowIdx));
  };

  callbacksRef.current.onViewChange = (state: { panX: number; panY: number; zoom: number }) => {
    viewStateRef.current = state;
    setZoom(state.zoom);
    trajectoryOverlayRef.current?.update();
    viewBroadcaster.maybeExecute(state);
  };

  callbacksRef.current.onFps = (fps: number) => setFps(fps);

  // Config created once — never changes identity (stable for GPU)
  const configRef = useRef<ScatterplotConfig>({
    callbacks: {
      onSelectionChange: (...args) => callbacksRef.current.onSelectionChange(...args),
      onPointClick: (...args) => callbacksRef.current.onPointClick(...args),
      onViewChange: (...args) => callbacksRef.current.onViewChange(...args),
      onFps: (...args) => callbacksRef.current.onFps(...args),
    },
  });

  // GPU lifecycle is now owned by ScatterGPUHost (see render return).
  // positionKey is a stable string dep passed to ScatterGPUHost.

  // ── Color updates without GPU re-init ─────────────────────────────────────
  const paletteRef = useRef<readonly (readonly [number, number, number])[]>([]);

  useEffect(() => {
    if (colorMode !== "categorical") return;
    const colors = categoryColors ?? [];
    // Wait until palette has been applied (empty strings = palette not yet loaded)
    if (colors.length === 0 || colors.some((c) => !c)) return;
    const palette = hexToRgbPalette(colors);
    paletteRef.current = palette;
    hostRef.current?.setColors(palette, data?.categoryIndices);
  }, [categoryColors, colorMode, data?.categoryIndices]);

  useEffect(() => {
    if (colorMode !== "continuous" || !data?.colorValues) return;
    hostRef.current?.setColorsDirect(data.colorValues);
  }, [data?.colorValues, colorMode]);

  // ── Cross-panel selection sync ────────────────────────────────────────────
  useEffect(() => {
    const sub = selectionSyncStore.subscribe(() => {
      const s = selectionSyncStore.state;
      if (s.type === "empty") {
        if (s.sourcePanelId === myPanelId) return; // skip own clear
        hostRef.current?.clearExternalSelection();
      } else {
        if (s.sourcePanelId === myPanelId) return; // skip own broadcasts
        hostRef.current?.setExternalSelection(s.selectedRowIndices);
      }
    });
    return () => sub.unsubscribe();
  }, [myPanelId]);

  // ── Cross-panel view sync ─────────────────────────────────────────────────
  useEffect(() => {
    const sub = viewSyncStore.subscribe(() => {
      const s = viewSyncStore.state;
      if (s.lockMode !== "linked" || s.sourcePanelId === myPanelId) return;
      hostRef.current?.setViewState({ panX: s.panX, panY: s.panY, zoom: s.zoom });
    });
    return () => sub.unsubscribe();
  }, [myPanelId]);

  // ── Trajectory ────────────────────────────────────────────────────────────
  const axesKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = axes ? `${axes.obsmKey}:${axes.xDim}:${axes.yDim}` : null;
    const changed = axesKeyRef.current !== null && key !== axesKeyRef.current;
    axesKeyRef.current = key;
    if (changed) actions.setTrajectory(null);
    setEmbedding(axes?.obsmKey ?? null);
  }, [axes, actions, setEmbedding]);

  const { showTrajectory, activeIndex } = useTrajectoryLoader({
    coordinator,
    table,
    xCol,
    yCol,
    categoryCol,
    metadata,
  });

  // ── Render ────────────────────────────────────────────────────────────────
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
      {/* GPU host — always mounted; never unmounted for loading/error states.
          Canvas lifecycle is decoupled from React render tree. */}
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

      {/* Loading overlay — on top of canvas, not instead of it */}
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

      {/* Trajectory SVG overlay */}
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

      {/* Legend */}
      {colorMode === "categorical" && categoryMapping && !showLoading ? <CategoricalLegend /> : null}
      {colorMode === "continuous" && colorByColumn && colorRange ? (
        <ContinuousLegend
          columnName={colorByColumn}
          colormap={continuousColormap}
          vmin={colorRange[0]}
          vmax={colorRange[1]}
        />
      ) : null}

      {/* Point info pane */}
      <div
        className="tp-overlay tp-overlay--bottom-left"
        style={highlightId ? undefined : { visibility: "hidden", pointerEvents: "none" }}
      >
        <PointInfoPane
          highlightId={highlightId}
          additionalFields={Object.keys(additionalFields)}
          onShowTrajectory={showTrajectory}
        />
      </div>
    </div>
  );
}
