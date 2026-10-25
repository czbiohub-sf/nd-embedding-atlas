/**
 * ScatterToolbar: the scatter's controls as a full-width row docked above the
 * canvas, so the points stay unobstructed. The active embedding is the
 * primary-filled bracketed chip [embedding]; everything else sits ghosted.
 *
 * Two zones in one row (wraps when narrow):
 *  left  → [⋰] bracket icon + embedding chip + X/Y(/Z) dims + 2D/3D (persp/ortho) + COL pickers
 *  right → selection tools + track/fit
 */

import { BoxSelect, ChartScatter, LassoSelect, Waypoints } from "lucide-react";
import { useMemo } from "react";
import { BracketIcon } from "@ndea/ui/components/bracket-icon";

/** Scan + Dot combined: "fit embedding to view" */
function ScanDotIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Scan: corner brackets */}
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      {/* Dot: center point */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

import type { ColorSource } from "./helpers";
import { cn } from "@ndea/ui/lib/utils";
import type { AxisState, ColorMode, DensityMode, SelectionDepth } from "./contracts";
import { EmbeddingPicker } from "./mudata/EmbeddingPicker";
import { ModalityColorPicker } from "./mudata/ModalityColorPicker";
import { ColorSourcePicker } from "./ColorSourcePicker";
import { Combobox, type ComboboxOption } from "@ndea/ui/components/combobox";
import { HoverTip } from "@ndea/ui/components/hover-tip";
import { iconButtonVariants } from "@ndea/ui/components/icon-button";
import { ToggleGroup, ToggleGroupItem } from "@ndea/ui/components/toggle-group";

interface Props {
  // Axes
  axes: AxisState;
  obsmKeys: string[];
  dims: number[];
  loadingKey: string | null;
  currentEntryLoaded: boolean;
  onSetAxes: (axes: AxisState) => void;
  /** Switch between 2D and 3D; undefined (disabled) when the embedding has fewer than 3 columns. */
  onToggle3D?: () => void;
  projection: "perspective" | "orthographic";
  onToggleProjection: () => void;

  // Color
  colorSource: ColorSource;
  obsColumns: string[];
  colorMode: ColorMode;
  colorModeCanToggle: boolean;
  /** Whether the dataset has a var/expression matrix: hides Var tab when false */
  hasVar: boolean;
  onSetColorSource: (src: ColorSource) => void;
  onToggleColorMode: () => void;
  /** Density compositing of categorical colors; cycles mean → dominant → weave. */
  densityMode: DensityMode;
  onCycleDensityMode: () => void;

  // MuData modality support (all optional: absent for single AnnData)
  modalities?: string[];
  modalityObsColumns?: Record<string, string[]>;
  varCount?: number | Record<string, number>;
  /** Full obsm metadata: used by modality-grouped EmbeddingPicker */
  obsm?: Record<string, { prefix: string; n_dims?: number | null; loaded: boolean; modality?: string }>;

  // Selection tool
  selectionTool: "pan" | "marquee" | "lasso";
  onSetSelectionTool: (t: "pan" | "marquee" | "lasso") => void;
  selectionDepth: SelectionDepth;
  /** 3D only (undefined in 2D): select through, or the nearest dense structure. */
  onToggleSelectionDepth?: () => void;
  onFitView?: () => void;
  trajectoryActive?: boolean;
  onToggleTrajectory?: () => void;

  hasSelection: boolean;
  selectionCount: number;
}

// The toolbar row carries the background, so the dim/COL triggers are ghost
// (transparent → shows the row, no box-in-box). The active embedding is the
// one filled accent. NB: dark:bg-transparent is required: the Combobox/
// ColorSourcePicker base sets dark:bg-input/30, which (a dark-variant rule)
// outranks a bare bg.
const ghostTrigger =
  "h-7 max-w-44 rounded-md border-0 bg-transparent dark:bg-transparent px-2 font-mono text-sm leading-none text-foreground/85 hover:bg-muted hover:text-foreground focus-visible:ring-0";
const chipActive =
  "h-7 max-w-44 gap-0 rounded-md border border-transparent bg-primary dark:bg-primary px-2.5 font-mono text-sm leading-none text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/40 before:mr-px before:text-primary-foreground/60 before:content-['['] after:ml-px after:text-primary-foreground/60 after:content-[']']";

/** X / Y / COLOR caption labels: mono, uppercase, dim. leading-none keeps
 *  the caption's line box flat so it centers on the same line as the values. */
const captionCls = "font-mono text-2xs uppercase leading-none tracking-[0.12em] text-muted-foreground";

/** Borderless square icon button for the top-right utility cluster: derives
 *  from the shadcn icon-button variant so toolbar buttons share one source
 *  with ui/icon-button (the toolbar keeps its own HoverTip wrap + ToggleGroup
 *  structure, which the bundled IconButton component can't model). */
const iconBtn = iconButtonVariants({ size: "md" });

export function ScatterToolbar({
  axes,
  obsmKeys,
  dims,
  loadingKey,
  currentEntryLoaded,
  onSetAxes,
  onToggle3D,
  projection,
  onToggleProjection,
  colorSource,
  obsColumns,
  colorMode,
  colorModeCanToggle,
  hasVar,
  onSetColorSource,
  onToggleColorMode,
  densityMode,
  onCycleDensityMode,
  modalities,
  modalityObsColumns,
  varCount,
  obsm,
  selectionTool,
  onSetSelectionTool,
  selectionDepth,
  onToggleSelectionDepth,
  onFitView,
  trajectoryActive,
  onToggleTrajectory,
  hasSelection,
  selectionCount,
}: Props) {
  const disabled = loadingKey !== null;
  const trigger = ghostTrigger;
  const btn = iconBtn;
  const icon = "size-3.5";
  // Mono caption-sized text toggles (palette/scale, 2D/3D, persp/ortho).
  const textToggle =
    "px-0.5 font-mono text-2xs leading-none text-muted-foreground/70 uppercase tracking-wide transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground/70";
  // Memoize option arrays to avoid churn on every render
  const embeddingOptions = useMemo<ComboboxOption[]>(
    () => obsmKeys.map((k) => ({ value: k, label: k.replace(/^X_/, "") })),
    [obsmKeys],
  );
  const dimOptions = useMemo<ComboboxOption[]>(() => dims.map((d) => ({ value: String(d), label: String(d) })), [dims]);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-card px-1.5 py-1">
      {/* ── Left zone: embedding + dims + color. Rhythm: tight inside a
          caption·value pair, medium between pairs, generous between groups ── */}
      <div className="flex min-w-0 items-center gap-2.5">
        <BracketIcon icon={ChartScatter} className="size-6 text-foreground/75" />

        {/* Embedding: primary-filled bracketed chip. Modality picker for MuData, combobox otherwise. */}
        {modalities && obsm ? (
          <EmbeddingPicker
            obsm={obsm}
            activeKey={axes.obsmKey}
            onSelect={(v) => onSetAxes({ ...axes, obsmKey: v, xDim: 0, yDim: 1 })}
            triggerClassName={chipActive}
            hideChevron
          />
        ) : (
          <Combobox
            value={axes.obsmKey}
            onValueChange={(v) => v && onSetAxes({ ...axes, obsmKey: v, xDim: 0, yDim: 1 })}
            options={embeddingOptions}
            placeholder="embedding"
            searchPlaceholder="Search embeddings…"
            disabled={disabled}
            triggerClassName={chipActive}
            contentClassName="w-48"
            hideChevron
          />
        )}

        {/* X / Y dims: two caption·value pairs */}
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-0.5" title="X axis: embedding dimension">
            <span className={captionCls}>X</span>
            <Combobox
              value={String(axes.xDim)}
              onValueChange={(v) => v !== "" && onSetAxes({ ...axes, xDim: Number(v) })}
              options={dimOptions}
              placeholder="0"
              searchPlaceholder="Search dims…"
              disabled={disabled || !currentEntryLoaded}
              triggerClassName={cn(trigger, "max-w-[3rem] justify-center")}
              contentClassName="w-32"
              hideChevron
            />
          </span>
          <span className="flex items-center gap-0.5" title="Y axis: embedding dimension">
            <span className={captionCls}>Y</span>
            <Combobox
              value={String(axes.yDim)}
              onValueChange={(v) => v !== "" && onSetAxes({ ...axes, yDim: Number(v) })}
              options={dimOptions}
              placeholder="1"
              searchPlaceholder="Search dims…"
              disabled={disabled || !currentEntryLoaded}
              triggerClassName={cn(trigger, "max-w-[3rem] justify-center")}
              contentClassName="w-32"
              hideChevron
            />
          </span>
          {axes.zDim !== null ? (
            <span className="flex items-center gap-0.5" title="Z axis: embedding dimension">
              <span className={captionCls}>Z</span>
              <Combobox
                value={String(axes.zDim)}
                onValueChange={(v) => v !== "" && onSetAxes({ ...axes, zDim: Number(v) })}
                options={dimOptions}
                placeholder="2"
                searchPlaceholder="Search dims…"
                disabled={disabled || !currentEntryLoaded}
                triggerClassName={cn(trigger, "max-w-[3rem] justify-center")}
                contentClassName="w-32"
                hideChevron
              />
            </span>
          ) : null}
          <button
            type="button"
            onClick={onToggle3D}
            disabled={!onToggle3D || disabled}
            title={onToggle3D ? "Switch between 2D and 3D" : "3D needs an embedding with 3+ columns"}
            className={textToggle}
          >
            {axes.zDim === null ? "3d" : "2d"}
          </button>
          {axes.zDim !== null ? (
            <button
              type="button"
              onClick={onToggleProjection}
              title="Perspective or orthographic projection"
              className={textToggle}
            >
              {projection === "perspective" ? "persp" : "ortho"}
            </button>
          ) : null}
        </div>

        {/* Color-by column */}
        <div className="flex min-w-0 items-center gap-0.5" title="color points by column">
          <span className={captionCls}>COLOR</span>
          {modalities && modalities.length > 0 ? (
            <ModalityColorPicker
              colorSource={colorSource}
              onSetColorSource={onSetColorSource}
              obsColumns={obsColumns}
              modalityObsColumns={modalityObsColumns}
              modalities={modalities}
              varCount={varCount}
              activeEmbeddingKey={axes.obsmKey}
              triggerClassName={trigger}
            />
          ) : (
            <ColorSourcePicker
              colorSource={colorSource}
              obsColumns={obsColumns}
              hasVar={hasVar}
              onSetColorSource={onSetColorSource}
              triggerClassName={trigger}
              contentClassName="w-64"
              hideChevron
            />
          )}
        </div>

        {colorModeCanToggle && (
          <button type="button" onClick={onToggleColorMode} className={textToggle}>
            {colorMode === "continuous" ? "scale" : "palette"}
          </button>
        )}
        {colorMode === "categorical" && (
          <button
            type="button"
            onClick={onCycleDensityMode}
            title="Dense overviews: average colors (mean), the most frequent category (dominant), or categories interleaved by share (weave)"
            className={textToggle}
          >
            {densityMode}
          </button>
        )}
      </div>

      <span className="min-w-2 flex-1" />

      {/* ── Right zone: selection tools + utility actions ── */}
      <div className="flex shrink-0 items-center gap-0.5">
        {/* Selection tool toggles */}
        <ToggleGroup
          value={selectionTool === "pan" ? [] : [selectionTool]}
          onValueChange={(v: string[]) => onSetSelectionTool((v[v.length - 1] as "marquee" | "lasso") ?? "pan")}
          className="gap-1"
        >
          <HoverTip
            label="Rectangle"
            description="Drag to select a region"
            side="bottom"
            render={<ToggleGroupItem value="marquee" className={btn} />}
          >
            <BoxSelect className={icon} />
          </HoverTip>
          <HoverTip
            label="Lasso"
            description="Trace a freehand region"
            side="bottom"
            render={<ToggleGroupItem value="lasso" className={btn} />}
          >
            <LassoSelect className={icon} />
          </HoverTip>
        </ToggleGroup>
        {onToggleSelectionDepth && (
          <button
            type="button"
            onClick={onToggleSelectionDepth}
            title="3D selection: everything inside the shape (through), or only the nearest dense structure (front)"
            className={textToggle}
          >
            {selectionDepth}
          </button>
        )}

        {hasSelection ? (
          <span className="font-mono text-2xs text-warning">lasso [{selectionCount.toLocaleString()}]</span>
        ) : null}

        {onToggleTrajectory && (
          <HoverTip
            label="Track"
            description={trajectoryActive ? "Hide the trajectory" : "Show the cell's trajectory"}
            side="bottom"
            render={
              <button
                type="button"
                onClick={onToggleTrajectory}
                aria-label="Track"
                className={cn(btn, trajectoryActive && "text-primary")}
              />
            }
          >
            <Waypoints className={icon} />
          </HoverTip>
        )}
        {onFitView && (
          <HoverTip
            label="Fit view"
            description="Zoom out to show all points"
            side="bottom"
            render={<button type="button" onClick={onFitView} aria-label="Fit view" className={btn} />}
          >
            <ScanDotIcon size={14} />
          </HoverTip>
        )}
      </div>
    </div>
  );
}
