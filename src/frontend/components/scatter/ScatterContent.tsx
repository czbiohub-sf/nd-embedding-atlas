/**
 * ScatterContent — generic scatter panel content, decoupled from any container.
 *
 * Works identically in:
 *  - A Dockview tiled panel (ScatterPanel wraps it)
 *  - A FloatingWindow (FloatingScatterItem wraps it)
 *  - Any future container
 */

import type { DockviewPanelApi } from "dockview-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { selectAnyTrajectory } from "../../dashboard/DashboardContext";
import { useDashboard } from "../../hooks/useDashboard";
import { colorSourceToString } from "../../lib/color-source";
import type { IsolationCapability } from "../../scatter-gpu/handle-capabilities";
import { useEmbeddingLoader } from "../../scatter-gpu/hooks/useEmbeddingLoader";
import { useIsolationBridge } from "../../scatter-gpu/hooks/useIsolationBridge";
import { useScatterColorState } from "../../scatter-gpu/hooks/useScatterColorState";
import type { PanelId } from "../../scatter-gpu/types";
import { broadcastPanelState, clearPanelState } from "../../stores/PanelStateStore";
import { disposeBitmap } from "../../stores/RoaringBroadcastStore";
import type { AxisState } from "../../types";
import { LegendProvider } from "./LegendContext";
import { ScatterOverlayControls } from "./ScatterOverlayControls";
import { ScatterView } from "./ScatterView";

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
    const { metadata, highlightId } = state;
    const trajectory = selectAnyTrajectory(state.trajectories);
    const activeTrajectories = Object.values(state.trajectories).filter(
        (t): t is NonNullable<typeof t> => t != null,
    );
    const { coordinator, brushSelection, table } = meta;

    // ── Embedding state ────────────────────────────────────────────────────────
    const [axes, setAxes] = useState<AxisState | null>(null);
    const { loadEmbedding, loadingKey } = useEmbeddingLoader(metadata, actions.refreshMetadata);

    // Use synced axes when provided (cross-panel link mode)
    const effectiveAxes = syncedAxes !== undefined ? syncedAxes : axes;

    useEffect(() => {
        if (axes || !metadata) return;
        const key =
            initialObsmKey ??
            Object.entries(metadata.obsm).find(([, v]) => v.loaded)?.[0] ??
            Object.keys(metadata.obsm)[0];
        if (!key) return;
        const entry = metadata.obsm[key];
        if (entry && !entry.loaded) {
            void loadEmbedding(key).then(() => setAxes({ obsmKey: key, xDim: 0, yDim: 1 }));
        } else {
            setAxes({ obsmKey: key, xDim: 0, yDim: 1 });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [metadata, axes, initialObsmKey, loadEmbedding]);

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
        clearCategoryMapping,
    } = useScatterColorState(coordinator, metadata);

    // ── Isolation → Mosaic cross-filter + GPU alpha dimming ───────────────────
    const isolationHandleRef = useRef<IsolationCapability | null>(null);
    const categoryIndicesRef = useRef<Uint8Array | null>(null);
    const fitViewRef = useRef<(() => void) | null>(null);

    // ── Selection state (hoisted so overlayControls can read row indices) ──────
    const rowIndicesRef = useRef<number[]>([]);
    const [selectionCount, setSelectionCount] = useState(0);
    const getRowIndices = useCallback((): readonly number[] => rowIndicesRef.current, []);
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

    // ── Broadcast panel state for cross-panel sync ─────────────────────────────
    useEffect(() => {
        broadcastPanelState(String(myPanelId), {
            axes: effectiveAxes,
            colorByColumn: colorSourceToString(colorSource),
        });
    }, [myPanelId, effectiveAxes, colorSource]);

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
        currentEntryLoaded: !!currentEntry?.loaded,
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
        activeTrajectories,
        metadata,
        actions,
        highlightId,
        isolationHandleRef,
        categoryIndicesRef,
        fitViewRef,
        rowIndicesRef,
        onRowIndicesChange: (indices: number[]) => {
            rowIndicesRef.current = indices;
            setSelectionCount(indices.length);
        },
    };

    const selectionPath = rowIndicesRef.current.length >= 5000 ? "temp_table" : "inline";
    const hasSelection = selectionCount > 0;

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
            onSetAxes={(newAxes) => {
                void handleSetAxes(newAxes);
            }}
            onSetColorSource={setColorSource}
            onToggleColorMode={() =>
                setColorModeOverride(colorMode === "continuous" ? "categorical" : "continuous")
            }
            selectionTool={selectionTool}
            onSetSelectionTool={setSelectionTool}
            onFitView={() => fitViewRef.current?.()}
            panelApi={panelApi}
            trajectoryActive={!!trajectory}
            onToggleTrajectory={
                trajectory ? () => actions.clearTrajectory(trajectory.datasetKey ?? "") : undefined
            }
            hasSelection={hasSelection}
            selectionCount={selectionCount}
            getRowIndices={getRowIndices}
            selectionPath={selectionPath}
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
                onStaleColumn={clearCategoryMapping}
            >
                <ScatterView {...scatterViewProps} overlayControls={overlayControls} />
            </LegendProvider>
        </div>
    );
}
