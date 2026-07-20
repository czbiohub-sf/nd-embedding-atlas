/**
 * ScatterContent: generic scatter panel content, decoupled from any container.
 *
 * Works identically in:
 *  - A Dockview tiled panel (ScatterPanel wraps it)
 *  - A FloatingWindow (FloatingScatterItem wraps it)
 *  - Any future container
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RowIndex } from "@ndea/sdk";
import { selectAnyTrajectory } from "@/core/session/dataset-session";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { capabilitiesOf } from "@ndea/sdk";
import type { IsolationCapability } from "@/nodes/scatter/gpu/handle-capabilities";
import { useEmbeddingLoader } from "@/nodes/scatter/gpu/hooks/useEmbeddingLoader";
import { useDisabledBridge } from "@/nodes/scatter/gpu/hooks/useDisabledBridge";
import { useIsolationBridge } from "@/nodes/scatter/gpu/hooks/useIsolationBridge";
import { useScatterColorState } from "@/nodes/scatter/gpu/hooks/useScatterColorState";
import { useTrajectoryLoader } from "@/nodes/scatter/gpu/hooks/useTrajectoryLoader";
import { useFocusedPointMeta } from "@/hooks/useFocusedPointMeta";
import { useHost } from "@/core/host/host-context";
import { useNodeFocus } from "@/core/node/use-node-focus";
import type { AxisState } from "@/types";
import { LegendProvider } from "./LegendContext";
import { ScatterToolbar } from "./ScatterToolbar";
import { useScatterUIState } from "./scatter-ui-store";
import { ScatterView } from "./ScatterView";
import type { ScatterCapabilities } from "./plugin";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ScatterContentProps {
  initialObsmKey?: string | null;
  initialColorByColumn?: string | null;
  /** container header slot: when present the toolbar portals there
   *  (compact, 26px-friendly) instead of docking above the canvas */
  toolbarTarget?: HTMLElement;
  onCreateCheckpoint?: () => void;
}

// ── ScatterContent ────────────────────────────────────────────────────────────

export function ScatterContent({
  initialObsmKey,
  initialColorByColumn: _initialColorByColumn,
  toolbarTarget,
  onCreateCheckpoint,
}: ScatterContentProps) {
  const { state, actions, runtime } = useDatasetSession();
  // The host owns this instance's WASM bitmap lifecycle (§6.6).
  const host = useHost<unknown, ScatterCapabilities>();
  const { metadata } = state;
  // Focus read: scoped to this instance's host (sync group / focus wire), so the
  // Point metadata follows the instance's group-aware host focus.
  const focusedRowIndex = useNodeFocus(host);
  const trajectory = selectAnyTrajectory(state.trajectories);
  const activeTrajectories = Object.values(state.trajectories).filter((t): t is NonNullable<typeof t> => t != null);
  const { coordinator, brushSelection, table } = runtime;

  // ── Embedding state ────────────────────────────────────────────────────────
  const [axes, setAxes] = useState<AxisState | null>(null);
  const { loadEmbedding, loadingKey } = useEmbeddingLoader(metadata, actions.refreshMetadata);

  const effectiveAxes = axes;

  useEffect(() => {
    if (axes || !metadata) return;
    const key =
      initialObsmKey ?? Object.entries(metadata.obsm).find(([, v]) => v.loaded)?.[0] ?? Object.keys(metadata.obsm)[0];
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
    categoricalColormap,
    setCategoricalColormap,
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
  // `rowIndicesRef` is the panel-level mapping populated once on GPU init.
  const rowIndicesRef = useRef<RowIndex[]>([]);
  // `selectedCount` from useScatterUIState is null when no lasso, count otherwise.
  const { selectedCount } = useScatterUIState();
  const selectionCount = selectedCount ?? 0;
  const { handleIsolationChange } = useIsolationBridge({
    coloredCategoryMapping,
    colorByColumn,
    scatterRef: isolationHandleRef,
    categoryIndicesRef,
  });
  const { handleDisabledChange } = useDisabledBridge({
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

  // ── Trajectory toggle (wired against the currently focused point) ──────
  // The ScatterToolbar button is the only entry point now: PointInfoPane
  // was removed. If a trajectory is active, the toggle clears it. Otherwise,
  // if the focused point is trackable, the toggle starts one. No
  // focus + no active trajectory → onToggleTrajectory is undefined and
  // ScatterToolbar hides the button.
  const { showTrajectory } = useTrajectoryLoader({
    embedding: effectiveAxes?.obsmKey ?? "",
    xCol,
    yCol,
    categoryCol,
  });
  const focusedPointMeta = useFocusedPointMeta(focusedRowIndex);

  const onToggleTrajectory = trajectory
    ? () => actions.clearTrajectory(trajectory.datasetKey ?? "")
    : focusedPointMeta.trackable
      ? () => {
          void showTrajectory(
            focusedPointMeta.trackId ?? 0,
            focusedPointMeta.fovName ?? "",
            focusedPointMeta.t,
            focusedPointMeta.datasetKey,
          );
        }
      : undefined;

  // Shared ScatterView props
  const scatterViewProps = {
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
    focusedRowIndex,
    isolationHandleRef,
    categoryIndicesRef,
    fitViewRef,
    rowIndicesRef,
    onRowIndicesChange: (indices: RowIndex[]) => {
      rowIndicesRef.current = indices;
    },
  };

  const hasSelection = selectionCount > 0;

  const toolbar = effectiveAxes ? (
    <ScatterToolbar
      variant={toolbarTarget ? "header" : "docked"}
      axes={effectiveAxes}
      obsmKeys={obsmKeys}
      dims={dims}
      loadingKey={loadingKey}
      currentEntryLoaded={!!currentEntry?.loaded}
      colorSource={colorSource}
      obsColumns={obsColumns}
      colorMode={colorMode}
      colorModeCanToggle={colorModeInfo.canToggle}
      hasVar={capabilitiesOf(metadata).has("var")}
      onSetAxes={(newAxes) => {
        void handleSetAxes(newAxes);
      }}
      onSetColorSource={setColorSource}
      onToggleColorMode={() => setColorModeOverride(colorMode === "continuous" ? "categorical" : "continuous")}
      modalities={metadata.modalities}
      modalityObsColumns={metadata.modality_obs_columns}
      varCount={metadata.var_count}
      obsm={metadata.obsm}
      selectionTool={selectionTool}
      onSetSelectionTool={setSelectionTool}
      onFitView={() => fitViewRef.current?.()}
      trajectoryActive={!!trajectory}
      onToggleTrajectory={onToggleTrajectory}
      hasSelection={hasSelection}
      selectionCount={selectionCount}
      onCreateCheckpoint={onCreateCheckpoint}
    />
  ) : null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {toolbarTarget && toolbar ? createPortal(toolbar, toolbarTarget) : toolbar}
      <LegendProvider
        categoryMapping={coloredCategoryMapping}
        coordinator={coordinator}
        selection={brushSelection}
        table={table}
        categoryCol={categoryCol}
        categoricalColormap={categoricalColormap}
        setCategoricalColormap={setCategoricalColormap}
        onIsolationChange={handleIsolationChange}
        onDisabledChange={handleDisabledChange}
        onStaleColumn={clearCategoryMapping}
      >
        <ScatterView {...scatterViewProps} />
      </LegendProvider>
    </div>
  );
}
