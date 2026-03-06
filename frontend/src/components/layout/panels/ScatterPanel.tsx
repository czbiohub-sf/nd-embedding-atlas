import type { IDockviewPanelProps } from "dockview-react";
import { EmbeddingViewMosaic } from "embedding-atlas/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContainerSize } from "../../../hooks/useContainerSize";
import { useDashboard } from "../../../hooks/useDashboard";
import { useEmbeddingLoader } from "../../../hooks/useEmbeddingLoader";
import { type CategoryMapping, makeCategoryColumn } from "../../../lib/category-column";
import { toRows } from "../../../lib/mosaic-helpers";
import type { AxisState, TrajectoryFrame } from "../../../types";
import { CategoricalLegend } from "../../scatter/CategoricalLegend";
import { LegendProvider, useEffectiveCategoryColors } from "../../scatter/LegendContext";
import { PointInfoPane } from "../../scatter/PointInfoPane";
import { TrajectoryOverlay } from "../../scatter/TrajectoryOverlay";

const SCATTER_CONFIG = { colorScheme: "dark" } as const;

/** No-op tooltip class — renders nothing, suppresses embedding-atlas default tooltip. */
class NoopTooltip {
    constructor(node: HTMLDivElement) {
        node.style.display = "none";
    }
    update() {}
    destroy() {}
}
const NOOP_TOOLTIP = { class: NoopTooltip };

export function ScatterPanel(_props: IDockviewPanelProps) {
    const { state, actions, meta } = useDashboard();
    const { metadata, highlightId, trajectory } = state;
    const { coordinator, brushSelection, table } = meta;

    // ── Per-panel embedding state ─────────────────────────────────────────
    const [axes, setAxes] = useState<AxisState | null>(null);
    const { loadEmbedding, loadingKey } = useEmbeddingLoader(metadata, actions.refreshMetadata);

    // Initialize from first loaded embedding
    useEffect(() => {
        if (axes || !metadata) return;
        const first = Object.entries(metadata.obsm).find(([, v]) => v.loaded);
        if (first) setAxes({ obsmKey: first[0], xDim: 0, yDim: 1 });
    }, [metadata, axes]);

    // Handle embedding change — load if needed, then update axes
    const handleSetAxes = async (newAxes: AxisState) => {
        const entry = metadata.obsm[newAxes.obsmKey];
        if (entry && !entry.loaded) {
            await loadEmbedding(newAxes.obsmKey);
        }
        setAxes(newAxes);
    };

    // ── Per-panel color-by state ─────────────────────────────────────────
    const [colorByColumn, setColorByColumn] = useState<string | null>(null);
    const obsColumns = useMemo(() => metadata.obs_columns ?? [], [metadata.obs_columns]);
    const additionalFields = useMemo(
        () =>
            Object.fromEntries(["track_id", "fov_name", "t"].filter((f) => obsColumns.includes(f)).map((f) => [f, f])),
        [obsColumns],
    );

    // ── Category column mapping ──────────────────────────────────────────
    const [categoryMapping, setCategoryMapping] = useState<CategoryMapping | null>(null);
    const [categoryLoading, setCategoryLoading] = useState(false);

    useEffect(() => {
        if (!colorByColumn) {
            setCategoryMapping(null);
            return;
        }
        let cancelled = false;
        setCategoryLoading(true);
        makeCategoryColumn(coordinator, colorByColumn).then(
            (mapping) => {
                if (!cancelled) {
                    setCategoryMapping(mapping);
                    setCategoryLoading(false);
                }
            },
            (err) => {
                console.error("Failed to create category column:", err);
                if (!cancelled) {
                    setCategoryMapping(null);
                    setCategoryLoading(false);
                }
            },
        );
        return () => {
            cancelled = true;
        };
    }, [coordinator, colorByColumn]);

    const categoryCol = categoryMapping?.indexColumn ?? null;

    // ── Derive rendering state ───────────────────────────────────────────
    const obsmKeys = axes ? Object.keys(metadata.obsm) : [];
    const currentEntry = axes ? metadata.obsm[axes.obsmKey] : null;
    const dims = Array.from({ length: currentEntry?.n_dims ?? 0 }, (_, i) => i);
    const prefix = currentEntry?.prefix ?? "x";
    const xCol = axes ? `${prefix}_${axes.xDim}` : "";
    const yCol = axes ? `${prefix}_${axes.yDim}` : "";

    const isLoading = !!loadingKey || categoryLoading;

    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-base">
            {/* ── Embedding selector ─────────────────────────────────── */}
            {axes ? (
                <div className="flex shrink-0 items-center gap-2 border-border-subtle border-b px-2 py-1 text-text-secondary">
                    <label className="flex items-center gap-1.5">
                        <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">
                            Embedding
                        </span>
                        <select
                            value={axes.obsmKey}
                            disabled={loadingKey !== null}
                            onChange={(e) =>
                                handleSetAxes({
                                    obsmKey: e.target.value,
                                    xDim: 0,
                                    yDim: 1,
                                })
                            }
                        >
                            {obsmKeys.map((k) => {
                                const entry = metadata.obsm[k];
                                const label = k.replace(/^X_/, "");
                                const suffix = entry?.loaded;
                                return (
                                    <option key={k} value={k}>
                                        {label}
                                        {suffix}
                                    </option>
                                );
                            })}
                        </select>
                    </label>

                    <label className="flex items-center gap-1">
                        <span className="text-[10px] text-text-muted">X</span>
                        <select
                            value={axes.xDim}
                            disabled={loadingKey !== null || !currentEntry?.loaded}
                            onChange={(e) =>
                                handleSetAxes({
                                    ...axes,
                                    xDim: Number(e.target.value),
                                })
                            }
                        >
                            {dims.map((d) => (
                                <option key={d} value={d}>
                                    {d}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="flex items-center gap-1">
                        <span className="text-[10px] text-text-muted">Y</span>
                        <select
                            value={axes.yDim}
                            disabled={loadingKey !== null || !currentEntry?.loaded}
                            onChange={(e) =>
                                handleSetAxes({
                                    ...axes,
                                    yDim: Number(e.target.value),
                                })
                            }
                        >
                            {dims.map((d) => (
                                <option key={d} value={d}>
                                    {d}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div className="h-4 w-px bg-border-subtle" />

                    <label className="flex items-center gap-1.5">
                        <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">Color</span>
                        <select value={colorByColumn ?? ""} onChange={(e) => setColorByColumn(e.target.value || null)}>
                            <option value="">none</option>
                            {obsColumns.map((col) => (
                                <option key={col} value={col}>
                                    {col}
                                </option>
                            ))}
                        </select>
                    </label>

                    {loadingKey ? (
                        <span className="animate-pulse text-[11px] text-accent-amber italic">
                            loading {loadingKey.replace(/^X_/, "")}...
                        </span>
                    ) : null}
                </div>
            ) : null}

            {/* ── Scatter view (wrapped in LegendProvider) ────────────── */}
            <LegendProvider
                categoryMapping={categoryMapping}
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
                    categoryCol={categoryCol}
                    categoryMapping={categoryMapping}
                    additionalFields={additionalFields}
                    brushSelection={brushSelection}
                    highlightId={highlightId}
                    trajectory={trajectory}
                    metadata={metadata}
                    actions={actions}
                />
            </LegendProvider>
        </div>
    );
}

// ── Inner component: consumes LegendContext for effective colors ──────────

interface ScatterViewProps {
    axes: AxisState | null;
    isLoading: boolean;
    loadingKey: string | null;
    coordinator: import("@uwdata/mosaic-core").Coordinator;
    table: string;
    xCol: string;
    yCol: string;
    categoryCol: string | null;
    categoryMapping: CategoryMapping | null;
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
    categoryCol,
    categoryMapping,
    additionalFields,
    brushSelection,
    highlightId,
    trajectory,
    metadata,
    actions,
}: ScatterViewProps) {
    const categoryColors = useEffectiveCategoryColors();

    const scatterRef = useRef<HTMLDivElement>(null);
    const size = useContainerSize(scatterRef);

    // ── Trajectory ────────────────────────────────────────────────────────

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
                const initialT = clickedT != null && rows.some((r) => r.t === clickedT) ? clickedT : rows[0].t;
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

    const overlayComponent = useMemo(
        () =>
            trajectory
                ? {
                      class: TrajectoryOverlay,
                      props: { points: trajectory.points, categoryColors, activeIndex },
                  }
                : null,
        [trajectory, categoryColors, activeIndex],
    );

    const trajectoryRef = useRef(trajectory);
    trajectoryRef.current = trajectory;

    const handleSelection = useCallback(
        (pts: unknown) => {
            const arr = pts as { identifier?: string | number | bigint }[] | null;
            const id = arr?.[0]?.identifier ?? null;
            actions.setHighlight(id != null ? String(id) : null);
            if (trajectoryRef.current) actions.setTrajectory(null);
        },
        [actions],
    );

    // ── Scatter content ──────────────────────────────────────────────────
    let scatterContent: React.ReactNode = null;
    if (!axes) {
        scatterContent = (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">No embedding loaded</div>
        );
    } else if (isLoading) {
        scatterContent = (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
                Loading
                {loadingKey ? ` ${loadingKey.replace(/^X_/, "")}...` : " colors..."}
            </div>
        );
    } else if (size.width > 0 && size.height > 0) {
        scatterContent = (
            <EmbeddingViewMosaic
                key={`${xCol}:${yCol}:${categoryCol ?? "none"}`}
                coordinator={coordinator}
                table={table}
                x={xCol}
                y={yCol}
                category={categoryCol}
                categoryColors={categoryColors}
                identifier="__row_index__"
                additionalFields={additionalFields}
                width={size.width}
                height={size.height}
                filter={brushSelection}
                rangeSelection={brushSelection}
                tooltip={null}
                text={null}
                config={SCATTER_CONFIG}
                onSelection={handleSelection}
                customTooltip={NOOP_TOOLTIP}
                customOverlay={overlayComponent}
            />
        );
    }

    return (
        <div
            ref={scatterRef}
            className={`relative min-h-0 flex-1 overflow-hidden${trajectory ? "trajectory-active" : ""}`}
        >
            {scatterContent}
            {categoryMapping && !isLoading ? <CategoricalLegend /> : null}
            <div
                className="tp-overlay tp-overlay--bottom-left"
                style={highlightId ? undefined : { visibility: "hidden", pointerEvents: "none" }}
            >
                <PointInfoPane
                    highlightId={highlightId}
                    coordinator={coordinator}
                    table={table}
                    additionalFields={Object.keys(additionalFields)}
                    onShowTrajectory={showTrajectory}
                />
            </div>
        </div>
    );
}
