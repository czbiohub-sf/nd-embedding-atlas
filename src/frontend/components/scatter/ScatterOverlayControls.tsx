/**
 * ScatterOverlayControls — controls imposed directly on the scatter canvas
 * (no glass bar). Per Sketch A: chip-style triggers float on the canvas, the
 * active embedding is the primary-filled bracketed chip [embedding].
 *
 * Two zones, both absolute-positioned:
 *  top-left  → [⋰] bracket icon + embedding chip + X/Y dim chips + COL chip
 *  top-right → borderless icon buttons (tools, Collections, track, fit, lock,
 *              pip, fullscreen, close)
 */

import {
  Bookmark,
  BoxSelect,
  ChartScatter,
  LassoSelect,
  Lock,
  LockOpen,
  Maximize2,
  PictureInPicture2Icon,
  Waypoints,
  X,
} from "lucide-react";
import { useMemo } from "react";
import { BracketIcon } from "../ui/bracket-icon";
import { useCollectionsSheet } from "../collections/CollectionsSheetProvider";

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

import { useSelector } from "@tanstack/react-store";
import type { DockviewPanelApi } from "dockview-react";
import type { ColorSource } from "../../lib/color-source";
import { colorSourceToString } from "../../lib/color-source";
import { cn } from "../../lib/utils";
import type { ColorMode } from "../../scatter-gpu/hooks/useMosaicScatterData";
import { addFloatingScatter } from "../../stores/FloatingScatterStore";
import { toggleViewLock, viewSyncStore } from "../../stores/ViewSyncStore";
import type { AxisState } from "../../types";
import { EmbeddingPicker } from "../mudata/EmbeddingPicker";
import { ModalityColorPicker } from "../mudata/ModalityColorPicker";
import { ColorSourcePicker } from "../scatter/ColorSourcePicker";
import { Combobox, type ComboboxOption } from "../ui/combobox";
import { HoverTip } from "../ui/hover-tip";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

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
  panelApi?: DockviewPanelApi;
  trajectoryActive?: boolean;
  onToggleTrajectory?: () => void;

  // Collection save
  hasSelection: boolean;
  selectionCount: number;
  /** Reads rowIndicesRef.current at call time — never stale */
  getRowIndices: () => readonly number[];
  selectionPath: "inline" | "temp_table";
}

// Controls float directly on the canvas (no glass bar). Each interactive value
// is a "chip": a solid card pill so it reads over busy point clouds. The active
// embedding is the primary-filled, bracketed chip — [phate].
const chipBase =
  "h-7 max-w-44 rounded-md border border-border bg-card px-2.5 font-mono text-2xs text-foreground/85 shadow-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30";
const chipActive =
  "h-7 max-w-44 gap-0 rounded-md border border-transparent bg-primary px-2.5 font-mono text-2xs text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/40 before:mr-px before:text-primary-foreground/60 before:content-['['] after:ml-px after:text-primary-foreground/60 after:content-[']']";

/** X / Y / COL caption labels — mono, uppercase, dim. */
const captionCls = "font-mono text-3xs uppercase tracking-[0.12em] text-muted-foreground";

/** Borderless square icon button for the top-right utility cluster. */
const iconBtn =
  "flex size-7 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export function ScatterOverlayControls({
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
  panelApi,
  trajectoryActive,
  onToggleTrajectory,
  hasSelection,
  selectionCount,
  getRowIndices,
  selectionPath: _selectionPath,
}: Props) {
  const { openSheet } = useCollectionsSheet();
  const lockMode = useSelector(viewSyncStore, (s) => s.lockMode);
  const isLinked = lockMode === "linked";
  const disabled = loadingKey !== null;

  // Memoize option arrays to avoid churn on every render
  const embeddingOptions = useMemo<ComboboxOption[]>(
    () => obsmKeys.map((k) => ({ value: k, label: k.replace(/^X_/, "") })),
    [obsmKeys],
  );
  const dimOptions = useMemo<ComboboxOption[]>(() => dims.map((d) => ({ value: String(d), label: String(d) })), [dims]);

  return (
    <>
      {/* ── Top-left: embedding + dims + color — floats on the canvas, no glass bar ── */}
      {/* max-w cap leaves room for the right utility cluster; the COL chip truncates first. */}
      <div className="absolute top-0 left-0 z-20 flex max-w-[calc(100%-13rem)] items-center gap-2 px-3 py-2.5">
        <BracketIcon icon={ChartScatter} className="mr-0.5 size-6 text-foreground/75" />

        {/* Embedding — primary-filled bracketed chip. Modality picker for MuData, combobox otherwise. */}
        {modalities && obsm ? (
          <EmbeddingPicker
            obsm={obsm}
            activeKey={axes.obsmKey}
            onSelect={(v) => onSetAxes({ obsmKey: v, xDim: 0, yDim: 1 })}
            triggerClassName={chipActive}
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
            triggerClassName={chipActive}
            contentClassName="w-48"
            hideChevron
          />
        )}

        {/* X / Y dims — caption + card chip */}
        <span className={captionCls}>X</span>
        <Combobox
          value={String(axes.xDim)}
          onValueChange={(v) => v !== "" && onSetAxes({ ...axes, xDim: Number(v) })}
          options={dimOptions}
          placeholder="0"
          searchPlaceholder="Search dims…"
          disabled={disabled || !currentEntryLoaded}
          triggerClassName={cn(chipBase, "max-w-[3rem] justify-center")}
          contentClassName="w-32"
          hideChevron
        />
        <span className={captionCls}>Y</span>
        <Combobox
          value={String(axes.yDim)}
          onValueChange={(v) => v !== "" && onSetAxes({ ...axes, yDim: Number(v) })}
          options={dimOptions}
          placeholder="1"
          searchPlaceholder="Search dims…"
          disabled={disabled || !currentEntryLoaded}
          triggerClassName={cn(chipBase, "max-w-[3rem] justify-center")}
          contentClassName="w-32"
          hideChevron
        />

        {/* Color column */}
        <span className={cn(captionCls, "ml-1")}>COL</span>
        {modalities && modalities.length > 0 ? (
          <ModalityColorPicker
            colorSource={colorSource}
            onSetColorSource={onSetColorSource}
            obsColumns={obsColumns}
            modalityObsColumns={modalityObsColumns}
            modalities={modalities}
            varCount={varCount}
            activeEmbeddingKey={axes.obsmKey}
            triggerClassName={chipBase}
          />
        ) : (
          <ColorSourcePicker
            colorSource={colorSource}
            obsColumns={obsColumns}
            hasVar={hasVar}
            onSetColorSource={onSetColorSource}
            triggerClassName={chipBase}
            contentClassName="w-64"
            hideChevron
          />
        )}

        {colorModeCanToggle && (
          <button
            type="button"
            onClick={onToggleColorMode}
            className="px-0.5 font-mono text-3xs text-muted-foreground/70 uppercase tracking-wide transition-colors hover:text-foreground"
          >
            {colorMode === "continuous" ? "scale" : "palette"}
          </button>
        )}
      </div>

      {/* ── Top-right: selection tools + utility actions — borderless icons, no glass ── */}
      <div className="absolute top-0 right-0 z-20 flex items-center gap-1 px-3 py-2.5">
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
                className={cn(iconBtn, "data-[state=on]:bg-accent data-[state=on]:text-foreground")}
              />
            }
          >
            <BoxSelect className="size-3.5" />
          </HoverTip>
          <HoverTip
            label="Lasso"
            description="Trace a freehand region"
            side="bottom"
            render={
              <ToggleGroupItem
                value="lasso"
                size="sm"
                className={cn(iconBtn, "data-[state=on]:bg-accent data-[state=on]:text-foreground")}
              />
            }
          >
            <LassoSelect className="size-3.5" />
          </HoverTip>
        </ToggleGroup>

        <HoverTip
          label="Collections"
          description={
            hasSelection
              ? `Open Collections — save ${selectionCount.toLocaleString()} obs or browse saved sets`
              : "Open Collections — browse saved sets (lasso a region to save a new one)"
          }
          side="bottom"
          render={
            <button
              type="button"
              onClick={() =>
                openSheet(hasSelection ? { selectionCount, getRowIndices } : null, { expandSave: hasSelection })
              }
              aria-label="Collections"
              className={iconBtn}
            />
          }
        >
          <Bookmark className="size-3.5" />
        </HoverTip>

        {onToggleTrajectory && (
          <HoverTip
            label="Track"
            description={trajectoryActive ? "Hide the trajectory" : "Show the cell's trajectory"}
            side="bottom"
            render={
              <button
                type="button"
                onClick={onToggleTrajectory}
                className={cn(iconBtn, trajectoryActive && "text-primary")}
              />
            }
          >
            <Waypoints className="size-3.5" />
          </HoverTip>
        )}
        {onFitView && (
          <HoverTip
            label="Fit view"
            description="Zoom out to show all points"
            side="bottom"
            render={<button type="button" onClick={onFitView} className={iconBtn} />}
          >
            <ScanDotIcon size={14} />
          </HoverTip>
        )}
        <HoverTip
          label={isLinked ? "Views linked" : "Link views"}
          description={isLinked ? "Click to pan each panel freely" : "Sync pan and zoom across panels"}
          side="bottom"
          render={<button type="button" onClick={toggleViewLock} className={cn(iconBtn, isLinked && "text-primary")} />}
        >
          {isLinked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
        </HoverTip>

        {panelApi && (
          <HoverTip
            label="Float"
            description="Detach to a floating window"
            side="bottom"
            render={
              <button
                type="button"
                onClick={() => {
                  addFloatingScatter({
                    id: `float-${Date.now()}`,
                    axes,
                    colorByColumn: colorSourceToString(colorSource),
                  });
                  panelApi.close();
                }}
                className={iconBtn}
              />
            }
          >
            <PictureInPicture2Icon className="size-3.5" />
          </HoverTip>
        )}

        {panelApi && (
          <HoverTip
            label="Fullscreen"
            description="Fill the workspace"
            side="bottom"
            render={
              <button
                type="button"
                onClick={() => (panelApi.isMaximized() ? panelApi.exitMaximized() : panelApi.maximize())}
                className={iconBtn}
              />
            }
          >
            <Maximize2 className="size-3.5" />
          </HoverTip>
        )}

        {panelApi && (
          <HoverTip
            label="Close"
            description="Remove this panel"
            side="bottom"
            render={
              <button
                type="button"
                onClick={() => panelApi.close()}
                className={cn(iconBtn, "hover:text-destructive")}
              />
            }
          >
            <X className="size-3.5" />
          </HoverTip>
        )}
      </div>
    </>
  );
}
