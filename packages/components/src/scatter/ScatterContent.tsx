/**
 * ScatterContent: generic scatter panel content, decoupled from any container.
 *
 * Works identically in:
 *  - A Dockview tiled panel (ScatterPanel wraps it)
 *  - A FloatingWindow (FloatingScatterItem wraps it)
 *  - Any future container
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { capabilitiesOf } from "@ndea/sdk";
import { useFocus, useScatterHost, useScatterSession } from "./context";
import { selectAnyTrajectory } from "./helpers";
import type { IsolationCapability } from "./gpu/handle-capabilities";
import { useEmbeddingLoader } from "./gpu/hooks/useEmbeddingLoader";
import { useIsolationBridge } from "./gpu/hooks/useIsolationBridge";
import { useScatterColorState } from "./gpu/hooks/useScatterColorState";
import { useTrajectoryLoader } from "./gpu/hooks/useTrajectoryLoader";
import type { AxisState, DensityMode, FocusedPointMeta, SelectionDepth } from "./contracts";
import { LegendProvider } from "./LegendContext";
import { ScatterToolbar } from "./ScatterToolbar";
import { useScatterUIState } from "./scatter-ui-store";
import { ScatterView } from "./ScatterView";

const DENSITY_CYCLE: readonly DensityMode[] = ["mean", "dominant", "weave"];

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ScatterContentProps {
  initialObsmKey?: string | null;
  /** Metadata of the host's focused point (bound by the view factory). */
  focusedPointMeta: FocusedPointMeta;
}

// ── ScatterContent ────────────────────────────────────────────────────────────

export function ScatterContent({ initialObsmKey, focusedPointMeta }: ScatterContentProps) {
  const { state, actions, runtime } = useScatterSession();
  // The host owns this instance's WASM bitmap lifecycle.
  const host = useScatterHost();
  const { metadata } = state;
  // Focus read: scoped to this element's host (coordination group), so the
  // point metadata follows the element's group-aware focus.
  const focusedRowIndex = useFocus(host);
  const trajectory = selectAnyTrajectory(state.trajectories);
  // Stable across renders: the GPU path and highlight re-upload when it changes.
  const activeTrajectories = useMemo(
    () => Object.values(state.trajectories).filter((t): t is NonNullable<typeof t> => t != null),
    [state.trajectories],
  );
  const { coordinator, brushSelection, table } = runtime;

  // ── Embedding state ────────────────────────────────────────────────────────
  const [axes, setAxes] = useState<AxisState | null>(null);
  const { loadEmbedding, loadingKey } = useEmbeddingLoader(metadata, actions.refreshMetadata);

  const effectiveAxes = axes;

  /** zDim only when the embedding has that column (the server 400s otherwise). */
  const withZ = (key: string, zDim: number | null): number | null =>
    zDim !== null && (metadata.obsm[key]?.n_dims ?? 0) > zDim ? zDim : null;

  useEffect(() => {
    if (axes || !metadata) return;
    const key =
      initialObsmKey ?? Object.entries(metadata.obsm).find(([, v]) => v.loaded)?.[0] ?? Object.keys(metadata.obsm)[0];
    if (!key) return;
    const entry = metadata.obsm[key];
    const initial = { obsmKey: key, xDim: 0, yDim: 1, zDim: withZ(key, host.config.zDim) };
    if (entry && !entry.loaded) {
      void loadEmbedding(key).then(() => setAxes(initial));
    } else {
      setAxes(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata, axes, initialObsmKey, loadEmbedding]);

  const handleSetAxes = async (newAxes: AxisState) => {
    const entry = metadata.obsm[newAxes.obsmKey];
    if (entry && !entry.loaded) await loadEmbedding(newAxes.obsmKey);
    const zDim = withZ(newAxes.obsmKey, newAxes.zDim);
    // Persist the embedding with zDim: a zDim alone falls back to 2D on another embedding.
    if (zDim !== (axes?.zDim ?? null) || newAxes.obsmKey !== axes?.obsmKey) {
      host.patchConfig({ obsmKey: newAxes.obsmKey, zDim });
    }
    setAxes({ ...newAxes, zDim });
  };

  // ── 3D projection (also synced through viewSync) ───────────────────────────
  const [projection, setProjection] = useState<"perspective" | "orthographic">("perspective");

  // ── Selection tool and 3D selection depth ──────────────────────────────────
  const [selectionTool, setSelectionTool] = useState<"pan" | "marquee" | "lasso">("pan");
  const [selectionDepth, setSelectionDepth] = useState<SelectionDepth>("through");
  const densityMode = host.config.density.mode;

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
  const fitViewRef = useRef<(() => void) | null>(null);

  // ── Selection state ─────────────────────────────────────────────────────────
  // `selectedCount` from useScatterUIState is null when no lasso, count otherwise.
  const { selectedCount } = useScatterUIState();
  const selectionCount = selectedCount ?? 0;
  const { handleIsolationChange } = useIsolationBridge({
    coloredCategoryMapping,
    colorByColumn,
    scatterRef: isolationHandleRef,
  });
  // Legend "disabled" (click a category dot) is purely visual: the GPU drops those
  // points from drawing, picking, and lasso; unlike isolation it writes no Mosaic predicate.
  const handleDisabledChange = useCallback(
    (disabled: Set<number>) => isolationHandleRef.current?.setCategoryDisabled(disabled),
    [],
  );

  // ── Derived rendering state ────────────────────────────────────────────────
  const obsmKeys = effectiveAxes ? Object.keys(metadata.obsm) : [];
  const currentEntry = effectiveAxes ? metadata.obsm[effectiveAxes.obsmKey] : null;
  const dims = Array.from({ length: currentEntry?.n_dims ?? 0 }, (_, i) => i);
  const prefix = currentEntry?.prefix ?? "x";
  const xCol = effectiveAxes ? `${prefix}_${effectiveAxes.xDim}` : "";
  const yCol = effectiveAxes ? `${prefix}_${effectiveAxes.yDim}` : "";
  const zCol = effectiveAxes?.zDim != null ? `${prefix}_${effectiveAxes.zDim}` : null;

  const isLoading = !!loadingKey || categoryLoading;

  // ── Trajectory toggle (wired against the currently focused point) ──────
  // The ScatterToolbar button is the only entry point now: PointInfoPane
  // was removed. If a trajectory is active, the toggle clears it. Otherwise,
  // if the focused point is trackable, the toggle starts one. No
  // focus + no active trajectory → onToggleTrajectory is undefined and
  // ScatterToolbar hides the button.
  const { showTrajectory } = useTrajectoryLoader({ categoryCol });

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
    zCol,
    projection,
    onProjectionChange: setProjection,
    selectionDepth,
    densityMode,
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
    fitViewRef,
  };

  const hasSelection = selectionCount > 0;

  const toolbar = effectiveAxes ? (
    <ScatterToolbar
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
      onToggle3D={
        dims.length >= 3
          ? () =>
              void handleSetAxes({
                ...effectiveAxes,
                zDim:
                  effectiveAxes.zDim === null
                    ? (dims.find((d) => d !== effectiveAxes.xDim && d !== effectiveAxes.yDim) ?? null)
                    : null,
              })
          : undefined
      }
      projection={projection}
      onToggleProjection={() => setProjection(projection === "perspective" ? "orthographic" : "perspective")}
      onSetColorSource={setColorSource}
      onToggleColorMode={() => setColorModeOverride(colorMode === "continuous" ? "categorical" : "continuous")}
      densityMode={densityMode}
      onCycleDensityMode={() =>
        host.patchConfig({ density: { mode: DENSITY_CYCLE[(DENSITY_CYCLE.indexOf(densityMode) + 1) % 3] } })
      }
      modalities={metadata.modalities}
      modalityObsColumns={metadata.modality_obs_columns}
      varCount={metadata.var_count}
      obsm={metadata.obsm}
      selectionTool={selectionTool}
      onSetSelectionTool={setSelectionTool}
      selectionDepth={selectionDepth}
      onToggleSelectionDepth={
        effectiveAxes.zDim !== null
          ? () => setSelectionDepth(selectionDepth === "through" ? "front" : "through")
          : undefined
      }
      onFitView={() => fitViewRef.current?.()}
      trajectoryActive={!!trajectory}
      onToggleTrajectory={onToggleTrajectory}
      hasSelection={hasSelection}
      selectionCount={selectionCount}
    />
  ) : null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {toolbar}
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
