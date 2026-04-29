/**
 * ScatterOverlayControls — glassmorphic controls overlaid on the scatter canvas.
 *
 * Two zones, both absolute-positioned:
 *  top-left  → embedding + x/y dim comboboxes + color column combobox
 *  top-right → selection tool toggles + utility button group (lock, pip, fullscreen, close)
 */

import {
  Bookmark,
  BoxSelect,
  LassoSelect,
  Lock,
  LockOpen,
  Maximize2,
  PictureInPicture2Icon,
  Waypoints,
  X,
} from "lucide-react";
import { useMemo } from "react";
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
import { ButtonGroup } from "../ui/button-group";
import { Combobox, type ComboboxOption } from "../ui/combobox";
import { HoverTip } from "../ui/hover-tip";
import { IconButton } from "../ui/icon-button";
import { Separator } from "../ui/separator";
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

const glass = "bg-card/75 backdrop-blur-md border border-white/[0.07] rounded-lg shadow-sm";

/** Glass-styled combobox trigger for use inside the overlay zones. */
const glassTrigger =
  "h-6 max-w-28 border-0 bg-transparent px-1.5 text-[11px] gap-1 text-foreground/80 hover:bg-white/10 hover:text-foreground focus-visible:ring-0";

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
      {/* ── Top-left: embedding + dims + color ── */}
      {/* max-w cap leaves room for the right utility group; the COL picker absorbs slack first. */}
      <div
        className={cn("absolute top-2 left-2 z-20 flex max-w-[calc(100%-15rem)] items-center gap-1 px-2 py-1", glass)}
      >
        {/* Embedding — modality-aware picker when MuData, plain combobox otherwise */}
        {modalities && obsm ? (
          <EmbeddingPicker
            obsm={obsm}
            activeKey={axes.obsmKey}
            onSelect={(v) => onSetAxes({ obsmKey: v, xDim: 0, yDim: 1 })}
            triggerClassName={cn(glassTrigger, "max-w-40")}
          />
        ) : (
          <Combobox
            value={axes.obsmKey}
            onValueChange={(v) => v && onSetAxes({ obsmKey: v, xDim: 0, yDim: 1 })}
            options={embeddingOptions}
            placeholder="embedding"
            searchPlaceholder="Search embeddings…"
            disabled={disabled}
            triggerClassName={cn(glassTrigger, "max-w-32")}
            contentClassName="w-48"
          />
        )}

        <Separator orientation="vertical" className="h-3 bg-white/[0.07]" />

        {/* X dim */}
        <span className="text-[10px] text-muted-foreground/60">x</span>
        <Combobox
          value={String(axes.xDim)}
          onValueChange={(v) => v !== "" && onSetAxes({ ...axes, xDim: Number(v) })}
          options={dimOptions}
          placeholder="0"
          searchPlaceholder="Search dims…"
          disabled={disabled || !currentEntryLoaded}
          triggerClassName={cn(glassTrigger, "max-w-[3rem]")}
          contentClassName="w-32"
        />

        {/* Y dim */}
        <span className="text-[10px] text-muted-foreground/60">y</span>
        <Combobox
          value={String(axes.yDim)}
          onValueChange={(v) => v !== "" && onSetAxes({ ...axes, yDim: Number(v) })}
          options={dimOptions}
          placeholder="1"
          searchPlaceholder="Search dims…"
          disabled={disabled || !currentEntryLoaded}
          triggerClassName={cn(glassTrigger, "max-w-[3rem]")}
          contentClassName="w-32"
        />

        <Separator orientation="vertical" className="h-3 bg-white/[0.07]" />

        {/* Color column — modality-aware picker when MuData, plain otherwise */}
        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">col</span>
        {modalities && modalities.length > 0 ? (
          <ModalityColorPicker
            colorSource={colorSource}
            onSetColorSource={onSetColorSource}
            obsColumns={obsColumns}
            modalityObsColumns={modalityObsColumns}
            modalities={modalities}
            varCount={varCount}
            activeEmbeddingKey={axes.obsmKey}
            triggerClassName={cn(glassTrigger, "max-w-40")}
          />
        ) : (
          <ColorSourcePicker
            colorSource={colorSource}
            obsColumns={obsColumns}
            hasVar={hasVar}
            onSetColorSource={onSetColorSource}
            triggerClassName={cn(glassTrigger, "max-w-36")}
            contentClassName="w-64"
          />
        )}

        {colorModeCanToggle && (
          <>
            <Separator orientation="vertical" className="h-3 bg-white/[0.07]" />
            <button
              type="button"
              onClick={onToggleColorMode}
              className="px-0.5 text-[10px] text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              {colorMode === "continuous" ? "scale" : "palette"}
            </button>
          </>
        )}
      </div>

      {/* ── Top-right: selection tools + utility actions ── */}
      <div className={cn("absolute top-2 right-2 z-20 flex items-center gap-1.5 px-1.5 py-1", glass)}>
        {/* Selection tool toggles */}
        <ToggleGroup
          value={selectionTool === "pan" ? [] : [selectionTool]}
          onValueChange={(v: string[]) => onSetSelectionTool((v[v.length - 1] as "marquee" | "lasso") ?? "pan")}
          className="gap-0"
        >
          <HoverTip
            label="Rectangle"
            description="Drag to select a region"
            side="bottom"
            render={
              <ToggleGroupItem
                value="marquee"
                size="sm"
                className="size-[22px] border-0 bg-transparent text-muted-foreground data-[state=on]:bg-white/15 data-[state=on]:text-foreground"
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
                className="size-[22px] border-0 bg-transparent text-muted-foreground data-[state=on]:bg-white/15 data-[state=on]:text-foreground"
              />
            }
          >
            <LassoSelect className="size-3.5" />
          </HoverTip>
        </ToggleGroup>

        <Separator orientation="vertical" className="mx-0.5 h-3 bg-white/[0.07]" />
        <IconButton
          label="Collections"
          description={
            hasSelection
              ? `Open Collections — save ${selectionCount.toLocaleString()} obs or browse saved sets`
              : "Open Collections — browse saved sets (lasso a region to save a new one)"
          }
          onClick={() =>
            openSheet(hasSelection ? { selectionCount, getRowIndices } : null, { expandSave: hasSelection })
          }
        >
          <Bookmark className="size-3.5" />
        </IconButton>

        <Separator orientation="vertical" className="mx-0.5 h-3 bg-white/[0.07]" />

        {/* Utility actions as a ButtonGroup */}
        <ButtonGroup className="border-white/[0.07] bg-transparent">
          {onToggleTrajectory && (
            <HoverTip
              label="Track"
              description={trajectoryActive ? "Hide the trajectory" : "Show the cell's trajectory"}
              side="bottom"
              render={
                <button
                  type="button"
                  onClick={onToggleTrajectory}
                  className={cn(
                    "flex size-[22px] items-center justify-center bg-transparent transition-colors hover:bg-white/10",
                    trajectoryActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                />
              }
            >
              <Waypoints className="size-3" />
            </HoverTip>
          )}
          {onFitView && (
            <HoverTip
              label="Fit view"
              description="Zoom out to show all points"
              side="bottom"
              render={
                <button
                  type="button"
                  onClick={onFitView}
                  className="flex size-[22px] items-center justify-center bg-transparent text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                />
              }
            >
              <ScanDotIcon size={12} />
            </HoverTip>
          )}
          <HoverTip
            label={isLinked ? "Views linked" : "Link views"}
            description={isLinked ? "Click to pan each panel freely" : "Sync pan and zoom across panels"}
            side="bottom"
            render={
              <button
                type="button"
                onClick={toggleViewLock}
                className={cn(
                  "flex size-[22px] items-center justify-center bg-transparent text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
                  isLinked && "text-primary",
                )}
              />
            }
          >
            {isLinked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
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
                  className="flex size-[22px] items-center justify-center bg-transparent text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                />
              }
            >
              <PictureInPicture2Icon className="size-3" />
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
                  className="flex size-[22px] items-center justify-center bg-transparent text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                />
              }
            >
              <Maximize2 className="size-3" />
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
                  className="flex size-[22px] items-center justify-center bg-transparent text-muted-foreground transition-colors hover:bg-white/10 hover:text-destructive"
                />
              }
            >
              <X className="size-3" />
            </HoverTip>
          )}
        </ButtonGroup>
      </div>
    </>
  );
}
