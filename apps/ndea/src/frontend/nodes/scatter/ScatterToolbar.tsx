/**
 * ScatterToolbar — the scatter's controls, two ways:
 *  · variant="header" — compact run portaled into the node/tile header's
 *    middle gap (host.ui.container.headerEl; the workspace surfaces)
 *  · variant="docked" — full-width row above a Stage or fullscreen surface
 *    whose container has no header slot
 * Either way the points stay unobstructed. The active embedding is the
 * primary-filled bracketed chip [embedding]; everything else sits ghosted.
 *
 * Two zones in one row (docked wraps when narrow; header clips):
 *  left  → [⋰] bracket icon + embedding chip + X/Y dim + COL pickers
 *  right → selection tools + checkpoint + track/fit
 */

import { BoxSelect, ChartScatter, LassoSelect, Snowflake, Waypoints } from "lucide-react";
import { useMemo } from "react";
import { BracketIcon } from "@/components/ui/bracket-icon";

/** Scan + Dot combined — "fit embedding to view" */
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
      {/* Scan — corner brackets */}
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      {/* Dot — center point */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

import type { ColorSource } from "@/lib/color/color-source";
import { cn } from "@/lib/utils";
import type { ColorMode } from "@/nodes/scatter/gpu/hooks/useMosaicScatterData";
import type { AxisState } from "@/types";
import { EmbeddingPicker } from "@/nodes/scatter/mudata/EmbeddingPicker";
import { ModalityColorPicker } from "@/nodes/scatter/mudata/ModalityColorPicker";
import { ColorSourcePicker } from "@/nodes/scatter/ColorSourcePicker";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { HoverTip } from "@/components/ui/hover-tip";
import { iconButtonVariants } from "@/components/ui/icon-button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface Props {
  // Axes
  axes: AxisState;
  obsmKeys: string[];
  dims: number[];
  loadingKey: string | null;
  currentEntryLoaded: boolean;
  onSetAxes: (axes: AxisState) => void;

  // Color
  colorSource: ColorSource;
  obsColumns: string[];
  colorMode: ColorMode;
  colorModeCanToggle: boolean;
  /** Whether the dataset has a var/expression matrix — hides Var tab when false */
  hasVar: boolean;
  onSetColorSource: (src: ColorSource) => void;
  onToggleColorMode: () => void;

  // MuData modality support (all optional — absent for single AnnData)
  modalities?: string[];
  modalityObsColumns?: Record<string, string[]>;
  varCount?: number | Record<string, number>;
  /** Full obsm metadata — used by modality-grouped EmbeddingPicker */
  obsm?: Record<string, { prefix: string; n_dims?: number | null; loaded: boolean; modality?: string }>;

  // Selection tool
  selectionTool: "pan" | "marquee" | "lasso";
  onSetSelectionTool: (t: "pan" | "marquee" | "lasso") => void;
  onFitView?: () => void;
  trajectoryActive?: boolean;
  onToggleTrajectory?: () => void;

  hasSelection: boolean;
  selectionCount: number;
  onCreateCheckpoint?: () => void;

  /** docked (default) = full-width row above the canvas;
   *  header = compact 26px-friendly run for a node/tile header slot */
  variant?: "docked" | "header";
}

// The toolbar row carries the background, so the dim/COL triggers are ghost
// (transparent → shows the row, no box-in-box). The active embedding is the
// one filled accent. NB: dark:bg-transparent is required — the Combobox/
// ColorSourcePicker base sets dark:bg-input/30, which (a dark-variant rule)
// outranks a bare bg.
const ghostTrigger =
  "h-7 max-w-44 rounded-md border-0 bg-transparent dark:bg-transparent px-2 font-mono text-2xs leading-none text-foreground/85 hover:bg-muted hover:text-foreground focus-visible:ring-0";
const chipActive =
  "h-7 max-w-44 gap-0 rounded-md border border-transparent bg-primary dark:bg-primary px-2.5 font-mono text-2xs leading-none text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/40 before:mr-px before:text-primary-foreground/60 before:content-['['] after:ml-px after:text-primary-foreground/60 after:content-[']']";

/** X / Y / COLOR caption labels — mono, uppercase, dim. leading-none keeps
 *  the caption's line box flat so it centers on the same line as the values. */
const captionCls = "font-mono text-3xs uppercase leading-none tracking-[0.12em] text-muted-foreground";

/** Borderless square icon button for the top-right utility cluster — derives
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
  colorSource,
  obsColumns,
  colorMode,
  colorModeCanToggle,
  hasVar,
  onSetColorSource,
  onToggleColorMode,
  modalities,
  modalityObsColumns,
  varCount,
  obsm,
  selectionTool,
  onSetSelectionTool,
  onFitView,
  trajectoryActive,
  onToggleTrajectory,
  hasSelection,
  selectionCount,
  onCreateCheckpoint,
  variant = "docked",
}: Props) {
  const disabled = loadingKey !== null;

  // header variant: fit inside the 26px node/tile header — shorter controls,
  // tighter caps, no wrap (overflow clips; popovers escape via portal)
  const compact = variant === "header";
  const trigger = cn(ghostTrigger, compact && "h-5 max-w-28 px-1.5");
  const chip = cn(chipActive, compact && "h-5 max-w-28 px-2");
  const btn = cn(iconBtn, compact && "size-5");
  const icon = compact ? "size-3" : "size-3.5";
  // header slot: utility buttons (everything past the selection tools) drop
  // out together when the slot is tight — the marquee/lasso pair survives
  const util = cn(btn, compact && "hidden @[22rem]:flex");

  // Memoize option arrays to avoid churn on every render
  const embeddingOptions = useMemo<ComboboxOption[]>(
    () => obsmKeys.map((k) => ({ value: k, label: k.replace(/^X_/, "") })),
    [obsmKeys],
  );
  const dimOptions = useMemo<ComboboxOption[]>(() => dims.map((d) => ({ value: String(d), label: String(d) })), [dims]);

  return (
    <div
      className={
        compact
          ? "flex h-full min-w-0 flex-1 items-center gap-x-1.5 overflow-hidden"
          : "flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-card px-1.5 py-1"
      }
    >
      {/* hairline boundary: node identity ends, controls begin */}
      {compact ? <span className="h-3.5 w-px shrink-0 bg-border-subtle" /> : null}

      {/* ── Left zone: embedding + dims + color. Rhythm: tight inside a
          caption·value pair, medium between pairs, generous between groups ── */}
      <div className={cn("flex min-w-0 items-center", compact ? "gap-2" : "gap-2.5")}>
        {/* the node header already carries LED + title — skip the glyph there */}
        {compact ? null : <BracketIcon icon={ChartScatter} className="size-6 text-foreground/75" />}

        {/* Embedding — primary-filled bracketed chip. Modality picker for MuData, combobox otherwise. */}
        {modalities && obsm ? (
          <EmbeddingPicker
            obsm={obsm}
            activeKey={axes.obsmKey}
            onSelect={(v) => onSetAxes({ obsmKey: v, xDim: 0, yDim: 1 })}
            triggerClassName={chip}
            hideChevron
          />
        ) : (
          <Combobox
            value={axes.obsmKey}
            onValueChange={(v) => v && onSetAxes({ obsmKey: v, xDim: 0, yDim: 1 })}
            options={embeddingOptions}
            placeholder="embedding"
            searchPlaceholder="Search embeddings…"
            disabled={disabled}
            triggerClassName={chip}
            contentClassName="w-48"
            hideChevron
          />
        )}

        {/* X / Y dims — two caption·value pairs. In the header slot this
            segment drops out below 26rem (priority: chip > color > dims) */}
        <div className={cn("items-center gap-1.5", compact ? "hidden @[26rem]:flex" : "flex")}>
          <span className="flex items-center gap-0.5" title="X axis — embedding dimension">
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
          <span className="flex items-center gap-0.5" title="Y axis — embedding dimension">
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
        </div>

        {/* Color-by column — gated at 17rem of slot width in the header */}
        <div
          className={cn("min-w-0 items-center gap-0.5", compact ? "hidden @[17rem]:flex" : "flex")}
          title="color points by column"
        >
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
          <button
            type="button"
            onClick={onToggleColorMode}
            className={cn(
              "px-0.5 font-mono text-3xs leading-none text-muted-foreground/70 uppercase tracking-wide transition-colors hover:text-foreground",
              compact && "hidden @[30rem]:block",
            )}
          >
            {colorMode === "continuous" ? "scale" : "palette"}
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
            render={
              <ToggleGroupItem
                value="marquee"
                size="sm"
                className={cn(btn, "data-[state=on]:bg-accent data-[state=on]:text-foreground")}
              />
            }
          >
            <BoxSelect className={icon} />
          </HoverTip>
          <HoverTip
            label="Lasso"
            description="Trace a freehand region"
            side="bottom"
            render={
              <ToggleGroupItem
                value="lasso"
                size="sm"
                className={cn(btn, "data-[state=on]:bg-accent data-[state=on]:text-foreground")}
              />
            }
          >
            <LassoSelect className={icon} />
          </HoverTip>
        </ToggleGroup>

        {hasSelection && onCreateCheckpoint ? (
          <>
            <span className={cn("font-mono text-3xs text-wire-sel", compact && "hidden @[18rem]:inline")}>
              lasso [{selectionCount.toLocaleString()}]
            </span>
            <HoverTip
              label="Cache"
              description="Create a Cache node pinned to the current lasso rows"
              side="bottom"
              render={<button type="button" onClick={onCreateCheckpoint} aria-label="Cache lasso" className={btn} />}
            >
              <Snowflake className={icon} />
            </HoverTip>
          </>
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
                className={cn(util, trajectoryActive && "text-primary")}
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
            render={<button type="button" onClick={onFitView} aria-label="Fit view" className={util} />}
          >
            <ScanDotIcon size={compact ? 12 : 14} />
          </HoverTip>
        )}
      </div>
    </div>
  );
}
