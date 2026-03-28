import type { IDockviewPanelProps } from "dockview-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { column, eq, literal, or } from "@uwdata/mosaic-sql";
import { ScatterGPUHost, type ScatterGPUHostHandle } from "../../../scatter-gpu/components/ScatterGPUHost";
import type { ScatterplotConfig } from "../../../scatter-gpu/types";
import { useMosaicScatterData } from "../../../scatter-gpu/hooks/useMosaicScatterData";
import type { ColorMode } from "../../../scatter-gpu/hooks/useMosaicScatterData";
import type { TrajectoryOverlaySvgHandle } from "../../scatter/TrajectoryOverlaySvg";
import { TrajectoryOverlaySvg } from "../../scatter/TrajectoryOverlaySvg";
import { ContinuousLegend } from "../../scatter/ContinuousLegend";
import { CategoricalLegend } from "../../scatter/CategoricalLegend";
import { LegendProvider, useEffectiveCategoryColors } from "../../scatter/LegendContext";
import { PointInfoPane } from "../../scatter/PointInfoPane";
import { CompactSelect } from "../../ui/select";
import { Button } from "../../ui/button";
import { useDashboard } from "../../../hooks/useDashboard";
import { useEmbeddingLoader } from "../../../hooks/useEmbeddingLoader";
import { useColumnTypes } from "../../../hooks/useColumnTypes";
import { makeCategoryColumn, type CategoryMapping } from "../../../lib/category-column";
import { resolveColorMode } from "../../../hooks/useColorMode";
import { toRows } from "../../../lib/mosaic-helpers";
import type { AxisState, TrajectoryFrame } from "../../../types";

// ── Helper ────────────────────────────────────────────────────────────────────

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

export function ScatterPanel(_props: IDockviewPanelProps) {
  const { state, actions, meta } = useDashboard();
  const { metadata, trajectory } = state;
  const { coordinator, brushSelection, table } = meta;

  // ── Per-panel embedding state ──────────────────────────────────────────────
  const [axes, setAxes] = useState<AxisState | null>(null);
  const { loadEmbedding, loadingKey } = useEmbeddingLoader(metadata, actions.refreshMetadata);

  // Initialize from first loaded embedding
  useEffect(() => {
    if (axes || !metadata) return;
    const first = Object.entries(metadata.obsm).find(([, v]) => v.loaded);
    if (first) setAxes({ obsmKey: first[0], xDim: 0, yDim: 1 });
  }, [metadata, axes]);

  const handleSetAxes = async (newAxes: AxisState) => {
    const entry = metadata.obsm[newAxes.obsmKey];
    if (entry && !entry.loaded) {
      await loadEmbedding(newAxes.obsmKey);
    }
    setAxes(newAxes);
  };

  // ── Color-by state ─────────────────────────────────────────────────────────
  const [colorByColumn, setColorByColumn] = useState<string | null>(null);
  const obsColumns = useMemo(() => metadata.obs_columns ?? [], [metadata.obs_columns]);

  // ── Color mode (categorical vs continuous) ─────────────────────────────────
  const columnTypes = useColumnTypes(coordinator);
  const [colorModeOverride, setColorModeOverride] = useState<ColorMode | undefined>(undefined);

  // Reset override when color column changes
  useEffect(() => {
    setColorModeOverride(undefined);
  }, [colorByColumn]);

  const colorModeInfo = useMemo(
    () => resolveColorMode(colorByColumn, columnTypes, colorModeOverride),
    [colorByColumn, columnTypes, colorModeOverride],
  );
  const colorMode: ColorMode = colorModeInfo.mode;

  // ── Categorical palette state ──────────────────────────────────────────────
  const [categoricalColormap, setCategoricalColormap] = useState("glasbey");
  const [continuousColormap, setContinuousColormap] = useState("viridis");
  const [maxCategories, setMaxCategories] = useState(64);
  const [palette, setPalette] = useState<string[]>([]);
  const [categoricalColormaps, setCategoricalColormaps] = useState<string[]>([]);
  const [continuousColormaps, setContinuousColormaps] = useState<string[]>([]);

  useEffect(() => {
    fetch("/data/colormaps")
      .then((r) => r.json())
      .then((data: { categorical?: string[]; continuous?: string[]; colormaps?: string[] }) => {
        // Support both old { colormaps } and new { categorical, continuous } formats
        setCategoricalColormaps(data.categorical ?? data.colormaps ?? []);
        setContinuousColormaps(data.continuous ?? []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetch(
      `/data/categorical-palette?colormap=${encodeURIComponent(categoricalColormap)}&n=${maxCategories}`,
    )
      .then((r) => r.json())
      .then((data: { colors: string[] }) => setPalette(data.colors))
      .catch(console.error);
  }, [categoricalColormap, maxCategories]);

  const additionalFields = useMemo(
    () =>
      Object.fromEntries(
        ["track_id", "fov_name", "t"]
          .filter((f) => obsColumns.includes(f))
          .map((f) => [f, f]),
      ),
    [obsColumns],
  );

  // ── Category column mapping ────────────────────────────────────────────────
  const [categoryMapping, setCategoryMapping] = useState<CategoryMapping | null>(null);
  const [categoryLoading, setCategoryLoading] = useState(false);

  useEffect(() => {
    if (!colorByColumn || colorMode !== "categorical") {
      setCategoryMapping(null);
      return;
    }
    let cancelled = false;
    setCategoryLoading(true);

    const run = async () => {
      const countResult = await coordinator.query(
        `SELECT COUNT(DISTINCT CAST("${colorByColumn}" AS TEXT))::INT AS n FROM obs_base`,
        { type: "json" },
      );
      if (cancelled) return;
      const n = Math.min(toRows<{ n: number }>(countResult)[0]?.n ?? 64, 256);
      setMaxCategories(n);

      const mapping = await makeCategoryColumn(coordinator, colorByColumn, n);
      if (!cancelled) {
        setCategoryMapping(mapping);
        setCategoryLoading(false);
      }
    };

    run().catch((err) => {
      console.error("Failed to create category column:", err);
      if (!cancelled) {
        setCategoryMapping(null);
        setCategoryLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [coordinator, colorByColumn, colorMode]);

  // Re-apply palette to existing mapping without touching DuckDB.
  // Return null (not categoryMapping) when palette isn't loaded yet — empty
  // color strings would propagate to the GPU and never trigger a re-color.
  const coloredCategoryMapping = useMemo(() => {
    if (!categoryMapping || palette.length === 0) return null;
    return {
      ...categoryMapping,
      legend: categoryMapping.legend.map((item) => ({
        ...item,
        color: palette[item.index % palette.length],
      })),
    };
  }, [categoryMapping, palette]);

  const categoryCol = coloredCategoryMapping?.indexColumn ?? null;

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
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-2 py-1 text-text-secondary">
          <label className="flex items-center gap-1.5">
            <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">
              Embedding
            </span>
            <CompactSelect
              value={axes.obsmKey}
              disabled={loadingKey !== null}
              options={obsmKeys.map((k) => ({ value: k, label: k.replace(/^X_/, "") }))}
              onChange={(v) => handleSetAxes({ obsmKey: v, xDim: 0, yDim: 1 })}
            />
          </label>

          <label className="flex items-center gap-1">
            <span className="text-[10px] text-text-muted">X</span>
            <CompactSelect
              value={String(axes.xDim)}
              disabled={loadingKey !== null || !currentEntry?.loaded}
              options={dims.map((d) => ({ value: String(d), label: String(d) }))}
              onChange={(v) => handleSetAxes({ ...axes, xDim: Number(v) })}
            />
          </label>

          <label className="flex items-center gap-1">
            <span className="text-[10px] text-text-muted">Y</span>
            <CompactSelect
              value={String(axes.yDim)}
              disabled={loadingKey !== null || !currentEntry?.loaded}
              options={dims.map((d) => ({ value: String(d), label: String(d) }))}
              onChange={(v) => handleSetAxes({ ...axes, yDim: Number(v) })}
            />
          </label>

          <div className="h-4 w-px bg-border-subtle" />

          <label className="flex items-center gap-1.5">
            <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">
              Color
            </span>
            <CompactSelect
              value={colorByColumn ?? ""}
              placeholder="none"
              options={obsColumns.map((col) => ({ value: col, label: col }))}
              onChange={(v) => setColorByColumn(v || null)}
            />
          </label>

          {colorModeInfo.canToggle && (
            <Button
              variant="ghost"
              size="xs"
              className="h-6 px-2 text-xs"
              onClick={() =>
                setColorModeOverride(colorMode === "continuous" ? "categorical" : "continuous")
              }
            >
              {colorMode === "continuous" ? "scale" : "palette"}
            </Button>
          )}

          {colorByColumn && colorMode === "categorical" ? (
            <>
              <div className="h-4 w-px bg-border-subtle" />
              <label className="flex items-center gap-1.5">
                <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">
                  Palette
                </span>
                <CompactSelect
                  value={categoricalColormap}
                  options={categoricalColormaps.map((c) => ({ value: c, label: c }))}
                  onChange={setCategoricalColormap}
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-[10px] text-text-muted">Max</span>
                <input
                  type="number"
                  min={2}
                  max={256}
                  value={maxCategories}
                  onChange={(e) =>
                    setMaxCategories(Math.max(2, Math.min(256, Number(e.target.value))))
                  }
                  className="w-14 h-6 rounded border border-border bg-input px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
            </>
          ) : null}

          {colorByColumn && colorMode === "continuous" ? (
            <>
              <div className="h-4 w-px bg-border-subtle" />
              <label className="flex items-center gap-1.5">
                <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">
                  Colormap
                </span>
                <CompactSelect
                  value={continuousColormap}
                  options={continuousColormaps.map((c) => ({ value: c, label: c }))}
                  onChange={setContinuousColormap}
                />
              </label>
            </>
          ) : null}

          {loadingKey ? (
            <span className="animate-pulse text-[11px] text-accent-amber italic">
              loading {loadingKey.replace(/^X_/, "")}...
            </span>
          ) : null}
        </div>
      ) : null}

      {/* ── Scatter view (wrapped in LegendProvider) ─────────────────────── */}
      <LegendProvider
        categoryMapping={coloredCategoryMapping}
        coordinator={coordinator}
        selection={brushSelection}
        table={table}
        categoryCol={categoryCol}
      >
        <ScatterView
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

  // ── Refs ──────────────────────────────────────────────────────────────────
  const hostRef = useRef<ScatterGPUHostHandle | null>(null);
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
  const scatterSourceRef = useRef<object>({});
  const [gpuError, setGpuError] = useState<string | null>(null);

  // ── Data from Mosaic binary endpoints ─────────────────────────────────────
  const { data, positionKey, colorRange, loading: dataLoading } = useMosaicScatterData({
    axes,
    xCol,
    yCol,
    colorMode,
    categoryCol,
    originalCol: colorByColumn,
    continuousColCol: colorMode === "continuous" ? colorByColumn : null,
    continuousColormap,
  });

  // ── Stable callbacks ref — GPU config never changes identity ──────────────
  const callbacksRef = useRef({
    onSelectionChange: (_count: number | null, _indices?: number[]) => {},
    onPointClick: (_index: number, _pos: [number, number], _catIdx: number, _catName: string) => {},
    onViewChange: (_zoom: number) => {},
  });

  // Update callbacks each render without recreating config
  callbacksRef.current.onSelectionChange = (_count, indices) => {
    const rowIds = (indices ?? []).map((i) => rowIndicesRef.current[i] ?? i);
    brushSelection.update({
      source: scatterSourceRef.current,
      clients: new Set(),
      value: rowIds,
      predicate:
        rowIds.length > 0
          ? or(...rowIds.map((id) => eq(column("__row_index__"), literal(id))))
          : null,
    });
  };

  callbacksRef.current.onPointClick = (index) => {
    const rowIdx = rowIndicesRef.current[index] ?? index;
    actions.setHighlight(String(rowIdx));
  };

  callbacksRef.current.onViewChange = () => {
    if (hostRef.current) viewStateRef.current = hostRef.current.getViewState();
    trajectoryOverlayRef.current?.update();
  };

  // Config created once — never changes identity (stable for GPU)
  const configRef = useRef<ScatterplotConfig>({
    callbacks: {
      onSelectionChange: (...args) => callbacksRef.current.onSelectionChange(...args),
      onPointClick: (...args) => callbacksRef.current.onPointClick(...args),
      onViewChange: (...args) => callbacksRef.current.onViewChange(...args),
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

  // ── Trajectory ────────────────────────────────────────────────────────────
  const axesKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = axes ? `${axes.obsmKey}:${axes.xDim}:${axes.yDim}` : null;
    const changed = axesKeyRef.current !== null && key !== axesKeyRef.current;
    axesKeyRef.current = key;
    if (changed) actions.setTrajectory(null);
  }, [axes, actions]);

  const showTrajectory = useCallback(
    async (trackId: number, fovName: string, clickedT?: number) => {
      const spatialX = metadata.spatial?.x_col ?? "x";
      const spatialY = metadata.spatial?.y_col ?? "y";
      const catSelect = categoryCol ? `, ${categoryCol} AS category` : "";
      const safeFovName = String(fovName).replace(/'/g, "''");
      const safeTrackId = Number.isFinite(trackId) ? trackId : 0;
      const sql = `SELECT ${xCol} AS emb_x, ${yCol} AS emb_y, ${spatialX} AS spatial_x, ${spatialY} AS spatial_y, t${catSelect} FROM ${table} WHERE track_id = ${safeTrackId} AND fov_name = '${safeFovName}' ORDER BY t ASC`;
      const result = await coordinator.query(sql, { type: "json" });
      const rows = toRows<TrajectoryFrame>(result);
      if (rows.length > 0) {
        const initialT =
          clickedT != null && rows.some((r) => r.t === clickedT) ? clickedT : rows[0].t;
        actions.setTrajectory({
          trackId,
          fovName,
          tIndex: initialT,
          points: rows,
        });
      }
    },
    [coordinator, table, xCol, yCol, categoryCol, actions, metadata.spatial],
  );

  const activeIndex = useMemo(() => {
    if (!trajectory) return null;
    const idx = trajectory.points.findIndex((p) => p.t === trajectory.tIndex);
    return idx >= 0 ? idx : null;
  }, [trajectory]);

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
        onRowIndicesChange={(indices) => { rowIndicesRef.current = indices; }}
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
      {colorMode === "categorical" && categoryMapping && !showLoading ? (
        <CategoricalLegend />
      ) : null}
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
