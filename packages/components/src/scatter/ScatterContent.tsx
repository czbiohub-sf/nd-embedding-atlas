/**
 * ScatterContent: the embedding view's body. Reads its config from the host at
 * mount and persists its own changes with `patchConfig` (no restart); the
 * floating controls render inside the view through `ScatterView.renderOverlays`.
 */

import { Axis3d, ChevronDownIcon, CircleDot, Lasso, MousePointer2, Pin, PinOff, SquareDashed } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { capabilitiesOf } from "@ndea/sdk";
import { Button } from "@ndea/ui/components/button";
import { ControlDivider, ControlGroup, ControlPopover, ControlRow } from "@ndea/ui/components/floating-controls";
import { IconButton } from "@ndea/ui/components/icon-button";
import { NdLegendContinuousIcon, NdLegendIcon } from "@ndea/ui/components/nd-icons";
import { Popover, PopoverContent, PopoverTrigger, popoverSeparator } from "@ndea/ui/components/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import { Slider } from "@ndea/ui/components/slider";
import { Segmented } from "@ndea/ui/components/toggle-group";
import { useFocus, useScatterHost, useScatterSession } from "./context";
import { dimLabel, selectAnyTrajectory } from "./helpers";
import type { IsolationCapability } from "./gpu/handle-capabilities";
import { useEmbeddingLoader } from "./gpu/hooks/useEmbeddingLoader";
import { useIsolationBridge } from "./gpu/hooks/useIsolationBridge";
import { useScatterColorState } from "./gpu/hooks/useScatterColorState";
import { useTrajectoryLoader } from "./gpu/hooks/useTrajectoryLoader";
import type {
  AxisState,
  DensityMode,
  FocusedPointMeta,
  ScatterConfig,
  SelectionDepth,
  SelectionTool,
} from "./contracts";
import { CategoricalPaletteGrid } from "./CategoricalPaletteGrid";
import { ColormapGrid } from "./ColormapGrid";
import { ColorSourcePicker } from "./ColorSourcePicker";
import { LegendProvider, useLegend } from "./LegendContext";
import { ModalityColorPicker } from "./mudata/ModalityColorPicker";
import { AxisPicker, PinnedLegend, SelectionPill, ToolButton } from "./ScatterControls";
import { type ScatterOverlays, ScatterView } from "./ScatterView";

const POINT_SIZE_DEFAULT = 0.002;

const TOOLS = [
  {
    tool: "pointer",
    key: "v",
    icon: <MousePointer2 />,
    label: "Select & focus · V",
    description: "Click a point to focus it",
  },
  { tool: "box", key: "b", icon: <SquareDashed />, label: "Box select · B", description: "shift adds, ⌥ subtracts" },
  { tool: "lasso", key: "l", icon: <Lasso />, label: "Lasso · L", description: "shift adds, ⌥ subtracts" },
] as const;

// V/B/L go to the hovered embedding view, else the last one interacted with.
let hoveredView: string | null = null;
let lastView: string | null = null;

/** Keys typed into a field or an open pop-up are not tool shortcuts. */
function typingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest(
        "input, textarea, select, [data-slot=popover-content], [data-slot=select-content], [role=dialog], [role=menu], [role=listbox]",
      ) !== null)
  );
}

const pickerTrigger =
  "h-[26px] w-full rounded-sm border-0 bg-muted px-[7px] text-ui-sm hover:bg-muted-2 dark:bg-muted dark:hover:bg-muted-2";

/** Popover row that opens a swatch grid (palette / colormap). */
function GridPicker({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <ControlRow label={label}>
      <Popover>
        <PopoverTrigger className={`${pickerTrigger} flex items-center justify-between gap-1.5 font-mono`}>
          <span className="truncate">{value}</span>
          <ChevronDownIcon className="size-[11px] text-text-muted" />
        </PopoverTrigger>
        <PopoverContent side="right" align="start" sideOffset={10} className="w-64">
          {children}
        </PopoverContent>
      </Popover>
    </ControlRow>
  );
}

/** Continuous colormap, reverse and scale: LegendContext state, so rendered inside the provider. */
function ColormapControls() {
  const { state, actions } = useLegend();
  return (
    <>
      <GridPicker label="Colormap" value={state.colormapName}>
        <ColormapGrid active={state.colormapName} onSelect={actions.setColormap} />
      </GridPicker>
      <ControlRow label="Direction">
        <Segmented
          label="Colormap direction"
          value={state.colormapReversed ? "reversed" : "normal"}
          options={[
            { value: "normal", label: "normal" },
            { value: "reversed", label: "reversed" },
          ]}
          onChange={(v) => actions.setColormapReversed(v === "reversed")}
        />
      </ControlRow>
      <ControlRow label="Scale">
        <Segmented
          label="Color scale"
          value={state.scale}
          options={[
            { value: "linear", label: "linear" },
            { value: "log", label: "log" },
            { value: "sqrt", label: "√" },
          ]}
          onChange={actions.setScale}
        />
      </ControlRow>
    </>
  );
}

export interface ScatterContentProps {
  /** Metadata of the host's focused point (bound by the view factory). */
  focusedPointMeta: FocusedPointMeta;
}

export function ScatterContent({ focusedPointMeta }: ScatterContentProps) {
  const { state, actions, runtime } = useScatterSession();
  const host = useScatterHost();
  const { metadata } = state;
  const focusedRowIndex = useFocus(host);
  const trajectory = selectAnyTrajectory(state.trajectories);
  // Stable across renders: the GPU path and highlight re-upload when it changes.
  const activeTrajectories = useMemo(
    () => Object.values(state.trajectories).filter((t): t is NonNullable<typeof t> => t != null),
    [state.trajectories],
  );
  const { coordinator, brushSelection, table } = runtime;

  // ── Config: read from the host, own changes persisted without a restart ────
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const config = host.config;
  const patch = useCallback(
    (next: Partial<ScatterConfig>) => {
      host.patchConfig(next);
      rerender();
    },
    [host],
  );

  // ── Embedding and axes ─────────────────────────────────────────────────────
  const { loadEmbedding, loadingKey } = useEmbeddingLoader(metadata, actions.refreshMetadata);
  // An unset or unknown obsmKey shows the default: the first loaded embedding, else the first.
  const obsmKey =
    config.obsmKey && metadata.obsm[config.obsmKey]
      ? config.obsmKey
      : (Object.entries(metadata.obsm).find(([, v]) => v.loaded)?.[0] ?? Object.keys(metadata.obsm)[0] ?? null);
  const entry = obsmKey ? metadata.obsm[obsmKey] : undefined;
  const entryLoaded = !!entry?.loaded;

  useEffect(() => {
    if (!obsmKey || entryLoaded) return;
    loadEmbedding(obsmKey).catch((error: unknown) => {
      if (!host.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
        host.notifications.notify(error instanceof Error ? error.message : String(error), "error");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obsmKey, entryLoaded]);

  const nDims = entry?.n_dims ?? 0;
  // Guard: dims the embedding lacks fall back (the server 400s on a missing column).
  const xDim = config.xDim < nDims ? config.xDim : 0;
  const yDim = config.yDim < nDims ? config.yDim : Math.min(1, nDims - 1);
  const zDim = config.zDim !== null && config.zDim < nDims ? config.zDim : null;
  const axes = useMemo<AxisState | null>(
    () => (obsmKey && entryLoaded && nDims > 0 ? { obsmKey, xDim, yDim, zDim } : null),
    [obsmKey, entryLoaded, nDims, xDim, yDim, zDim],
  );
  const prefix = entry?.prefix ?? "x";
  const xCol = axes ? `${prefix}_${axes.xDim}` : "";
  const yCol = axes ? `${prefix}_${axes.yDim}` : "";
  const zCol = axes?.zDim != null ? `${prefix}_${axes.zDim}` : null;

  // ── View-local state: tool, 3D projection (also synced via viewSync), depth ─
  const [selectionTool, setSelectionTool] = useState<SelectionTool>("pointer");
  const [projection, setProjection] = useState<"perspective" | "orthographic">("perspective");
  const [selectionDepth, setSelectionDepth] = useState<SelectionDepth>("through");
  const [liveSize, setLiveSize] = useState<number | null>(null);
  const pointSize = liveSize ?? config.pointSize;

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = host.elementId;
    const root = rootRef.current;
    if (!root) return;
    const enter = () => (hoveredView = id);
    const leave = () => {
      if (hoveredView === id) hoveredView = null;
    };
    const down = () => (lastView = id);
    const key = (e: KeyboardEvent) => {
      if ((hoveredView ?? lastView) !== id || e.metaKey || e.ctrlKey || e.altKey || typingTarget(e.target)) return;
      const tool = TOOLS.find((t) => t.key === e.key.toLowerCase())?.tool;
      if (tool) setSelectionTool(tool);
    };
    root.addEventListener("pointerenter", enter);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      leave();
      if (lastView === id) lastView = null;
      root.removeEventListener("pointerenter", enter);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [host]);

  // ── Color state ────────────────────────────────────────────────────────────
  const {
    colorByColumn,
    colorSource,
    setColorSource,
    obsColumns,
    colorMode,
    setColorModeOverride,
    colorModeInfo,
    categoricalColormap,
    setCategoricalColormap,
    continuousColormap,
    categoryLoading,
    coloredCategoryMapping,
    categoryCol,
    clearCategoryMapping,
  } = useScatterColorState(coordinator);

  // ── Isolation → Mosaic cross-filter + GPU alpha dimming ───────────────────
  const isolationHandleRef = useRef<IsolationCapability | null>(null);
  const fitViewRef = useRef<(() => void) | null>(null);
  const { handleIsolationChange } = useIsolationBridge({
    coloredCategoryMapping,
    colorByColumn,
    scatterRef: isolationHandleRef,
  });
  // Legend "hidden" (click a category dot) is purely visual: the GPU drops those
  // points from drawing, picking, and selection; unlike isolation it writes no Mosaic predicate.
  const handleDisabledChange = useCallback(
    (disabled: Set<number>) => isolationHandleRef.current?.setCategoryDisabled(disabled),
    [],
  );

  // ── Trajectory toggle (against the focused point) ──────────────────────────
  // Active trajectory → the toggle clears it; else a trackable focused point starts one.
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

  const pinned = config.legend === "pinned";
  const densityMode = config.density.mode;

  const colorPicker =
    metadata.modalities && metadata.modalities.length > 0 ? (
      <ModalityColorPicker
        colorSource={colorSource}
        onSetColorSource={setColorSource}
        obsColumns={obsColumns}
        modalityObsColumns={metadata.modality_obs_columns}
        modalities={metadata.modalities}
        varCount={metadata.var_count}
        activeEmbeddingKey={obsmKey ?? undefined}
        triggerClassName={pickerTrigger}
      />
    ) : (
      <ColorSourcePicker
        colorSource={colorSource}
        obsColumns={obsColumns}
        hasVar={capabilitiesOf(metadata).has("var")}
        onSetColorSource={setColorSource}
        triggerClassName={pickerTrigger}
        contentClassName="w-64"
      />
    );

  const renderOverlays = ({ legend, selection }: ScatterOverlays) => (
    <>
      <ControlGroup>
        {TOOLS.map((t) => (
          <ToolButton
            key={t.tool}
            label={t.label}
            description={t.description}
            pressed={selectionTool === t.tool}
            onClick={() => setSelectionTool(t.tool)}
          >
            {t.icon}
          </ToolButton>
        ))}
        <ControlDivider />
        <ControlPopover
          icon={colorMode === "continuous" ? <NdLegendContinuousIcon /> : <NdLegendIcon />}
          label="Legend"
          description="Color by, palette, density"
          title="Legend"
          action={
            <IconButton
              label={pinned ? "Unpin legend" : "Pin legend"}
              description={pinned ? "Back into this popover" : "Keep it in the view's bottom-left"}
              pressed={pinned}
              onClick={() => patch({ legend: pinned ? "popover" : "pinned" })}
            >
              {pinned ? <PinOff /> : <Pin />}
            </IconButton>
          }
        >
          <ControlRow label="Color by">{colorPicker}</ControlRow>
          {colorModeInfo.canToggle ? (
            <ControlRow label="As">
              <Segmented
                label="Color as"
                value={colorMode}
                options={[
                  { value: "categorical", label: "palette" },
                  { value: "continuous", label: "scale" },
                ]}
                onChange={setColorModeOverride}
              />
            </ControlRow>
          ) : null}
          {colorMode === "continuous" && colorByColumn ? (
            <ColormapControls />
          ) : colorByColumn ? (
            <>
              <GridPicker label="Palette" value={categoricalColormap}>
                <CategoricalPaletteGrid active={categoricalColormap} onSelect={setCategoricalColormap} />
              </GridPicker>
              <ControlRow label="Density">
                <Segmented<DensityMode>
                  label="Dense overviews: average colors, the most frequent category, or categories interleaved by share"
                  value={densityMode}
                  options={[
                    { value: "mean", label: "mean" },
                    { value: "dominant", label: "dominant" },
                    { value: "weave", label: "weave" },
                  ]}
                  onChange={(mode) => patch({ density: { mode } })}
                />
              </ControlRow>
            </>
          ) : null}
          {legend && !pinned ? (
            <>
              <div className={popoverSeparator} />
              {legend}
            </>
          ) : null}
        </ControlPopover>
        <ControlPopover icon={<CircleDot />} label="Point size" title="Point size">
          <ControlRow label="Size">
            <Slider
              className="flex-1"
              min={0.0005}
              max={0.01}
              step={0.0005}
              value={[pointSize]}
              onValueChange={(v) => setLiveSize(Array.isArray(v) ? v[0] : v)}
              onValueCommitted={(v) => {
                patch({ pointSize: Array.isArray(v) ? v[0] : v });
                setLiveSize(null);
              }}
            />
            <span className="w-9 text-right font-mono text-xs text-text-muted tabular-nums">
              {(pointSize / POINT_SIZE_DEFAULT).toFixed(2)}×
            </span>
          </ControlRow>
          <ControlRow label="Trajectory">
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={!!trajectory}
              disabled={!onToggleTrajectory}
              title={onToggleTrajectory ? undefined : "Focus a tracked obs to show its trajectory"}
              onClick={onToggleTrajectory}
            >
              {trajectory ? "Hide track" : "Show track"}
            </Button>
          </ControlRow>
        </ControlPopover>
        <ControlPopover icon={<Axis3d />} label="Axes" description="2D or 3D, projection, fit view" title="Axes">
          <ControlRow label="View">
            <Segmented
              label="2D or 3D"
              value={zDim === null ? "2d" : "3d"}
              options={[
                { value: "2d", label: "2D" },
                { value: "3d", label: "3D", disabled: nDims < 3 },
              ]}
              onChange={(v) =>
                patch({
                  zDim:
                    v === "2d"
                      ? null
                      : (Array.from({ length: nDims }, (_, d) => d).find((d) => d !== xDim && d !== yDim) ?? null),
                })
              }
            />
          </ControlRow>
          {nDims < 3 ? <p className="px-1.5 text-sm text-text-muted">3D needs an embedding with 3+ dims.</p> : null}
          {zDim !== null && obsmKey ? (
            <>
              <ControlRow label="z">
                <Select value={zDim} onValueChange={(d) => d !== null && patch({ zDim: d })}>
                  <SelectTrigger size="sm" aria-label="z axis dimension" className="font-mono">
                    <SelectValue>{(d: number) => dimLabel(obsmKey, d)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: nDims }, (_, d) => (
                      <SelectItem key={d} value={d} className="font-mono">
                        {dimLabel(obsmKey, d)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ControlRow>
              <ControlRow label="Projection">
                <Segmented
                  label="Projection"
                  value={projection}
                  options={[
                    { value: "perspective", label: "persp" },
                    { value: "orthographic", label: "ortho" },
                  ]}
                  onChange={setProjection}
                />
              </ControlRow>
              <ControlRow label="Selects">
                <Segmented<SelectionDepth>
                  label="3D selection: everything inside the shape (through), or only the nearest dense structure (front)"
                  value={selectionDepth}
                  options={[
                    { value: "through", label: "through" },
                    { value: "front", label: "front" },
                  ]}
                  onChange={setSelectionDepth}
                />
              </ControlRow>
            </>
          ) : null}
          <Button variant="secondary" size="sm" className="mx-1.5 mt-1" onClick={() => fitViewRef.current?.()}>
            Fit view
          </Button>
        </ControlPopover>
      </ControlGroup>
      {pinned && legend ? <PinnedLegend>{legend}</PinnedLegend> : null}
      {obsmKey ? (
        <AxisPicker obsmKey={obsmKey} nDims={nDims} xDim={xDim} yDim={yDim} onChange={(next) => patch(next)} />
      ) : null}
      {selection.state ? (
        <SelectionPill
          selection={selection.state}
          onInvert={selection.invert}
          onSave={selection.saveAsSource}
          onClear={() => selection.clear()}
        />
      ) : null}
    </>
  );

  return (
    <div ref={rootRef} className="flex h-full w-full flex-col overflow-hidden">
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
        <ScatterView
          selectionTool={selectionTool}
          pointSize={pointSize}
          renderOverlays={renderOverlays}
          axes={axes}
          isLoading={!!loadingKey || categoryLoading}
          loadingKey={loadingKey}
          currentEntryLoaded={entryLoaded}
          coordinator={coordinator}
          table={table}
          xCol={xCol}
          yCol={yCol}
          zCol={zCol}
          projection={projection}
          onProjectionChange={setProjection}
          selectionDepth={selectionDepth}
          densityMode={densityMode}
          colorMode={colorMode}
          categoryCol={categoryCol}
          categoryMapping={coloredCategoryMapping}
          colorByColumn={colorByColumn}
          continuousColormap={continuousColormap}
          trajectory={trajectory}
          activeTrajectories={activeTrajectories}
          metadata={metadata}
          actions={actions}
          focusedRowIndex={focusedRowIndex}
          isolationHandleRef={isolationHandleRef}
          fitViewRef={fitViewRef}
        />
      </LegendProvider>
    </div>
  );
}
