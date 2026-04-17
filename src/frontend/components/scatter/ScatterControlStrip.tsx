/**
 * ScatterControlStrip — per-panel embedding/dim/color control bar.
 *
 * Extracted verbatim from ScatterPanel's inline toolbar block.
 * All state and callbacks live in ScatterPanel; this component is pure UI.
 */

import { useSelector } from "@tanstack/react-store";
import { BoxSelect, LassoSelect, Lock, LockOpen } from "lucide-react";
import type { ColorMode } from "../../scatter-gpu/hooks/useMosaicScatterData";
import { toggleViewLock, viewSyncStore } from "../../stores/ViewSyncStore";
import type { AxisState } from "../../types";
import { Button } from "../ui/button";
import { CompactSelect } from "../ui/select";
import { Separator } from "../ui/separator";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export interface ScatterControlStripProps {
  axes: AxisState;
  obsmKeys: string[];
  dims: number[];
  loadingKey: string | null;
  currentEntryLoaded: boolean;

  colorByColumn: string | null;
  obsColumns: string[];
  colorMode: ColorMode;
  colorModeCanToggle: boolean;

  categoricalColormap: string;
  categoricalColormaps: string[];
  continuousColormap: string;
  continuousColormaps: string[];
  maxCategories: number;

  onSetAxes: (axes: AxisState) => void;
  onSetColorByColumn: (col: string | null) => void;
  onToggleColorMode: () => void;
  onSetCategoricalColormap: (c: string) => void;
  onSetContinuousColormap: (c: string) => void;
  onSetMaxCategories: (n: number) => void;

  selectionTool: "pan" | "marquee" | "lasso";
  onSetSelectionTool: (tool: "pan" | "marquee" | "lasso") => void;
}

export function ScatterControlStrip({
  axes,
  obsmKeys,
  dims,
  loadingKey,
  currentEntryLoaded,
  colorByColumn,
  obsColumns,
  colorMode,
  colorModeCanToggle,
  categoricalColormap,
  categoricalColormaps,
  continuousColormap,
  continuousColormaps,
  maxCategories,
  onSetAxes,
  onSetColorByColumn,
  onToggleColorMode,
  onSetCategoricalColormap,
  onSetContinuousColormap,
  onSetMaxCategories,
  selectionTool,
  onSetSelectionTool,
}: ScatterControlStripProps) {
  const lockMode = useSelector(viewSyncStore, (s) => s.lockMode);
  const isLinked = lockMode === "linked";

  return (
    <div className="flex shrink-0 items-center gap-2 border-border-subtle border-b px-2 py-1 text-text-secondary">
      <label className="flex items-center gap-1.5">
        <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">Embedding</span>
        <CompactSelect
          value={axes.obsmKey}
          disabled={loadingKey !== null}
          options={obsmKeys.map((k) => ({ value: k, label: k.replace(/^X_/, "") }))}
          onChange={(v: string) => onSetAxes({ obsmKey: v, xDim: 0, yDim: 1 })}
        />
      </label>

      <label className="flex items-center gap-1">
        <span className="text-[10px] text-text-muted">X</span>
        <CompactSelect
          value={String(axes.xDim)}
          disabled={loadingKey !== null || !currentEntryLoaded}
          options={dims.map((d) => ({ value: String(d), label: String(d) }))}
          onChange={(v: string) => onSetAxes({ ...axes, xDim: Number(v) })}
        />
      </label>

      <label className="flex items-center gap-1">
        <span className="text-[10px] text-text-muted">Y</span>
        <CompactSelect
          value={String(axes.yDim)}
          disabled={loadingKey !== null || !currentEntryLoaded}
          options={dims.map((d) => ({ value: String(d), label: String(d) }))}
          onChange={(v: string) => onSetAxes({ ...axes, yDim: Number(v) })}
        />
      </label>

      <Separator orientation="vertical" className="h-4" />

      <label className="flex items-center gap-1.5">
        <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">Color</span>
        <CompactSelect
          value={colorByColumn ?? ""}
          placeholder="none"
          options={obsColumns.map((col) => ({ value: col, label: col }))}
          onChange={(v: string) => onSetColorByColumn(v || null)}
        />
      </label>

      {colorModeCanToggle && (
        <Button variant="ghost" size="xs" className="h-6 px-2 text-xs" onClick={onToggleColorMode}>
          {colorMode === "continuous" ? "scale" : "palette"}
        </Button>
      )}

      {colorByColumn && colorMode === "categorical" ? (
        <>
          <div className="h-4 w-px bg-border-subtle" />
          <label className="flex items-center gap-1.5">
            <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">Palette</span>
            <CompactSelect
              value={categoricalColormap}
              options={categoricalColormaps.map((c) => ({ value: c, label: c }))}
              onChange={onSetCategoricalColormap}
            />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-[10px] text-text-muted">Max</span>
            <input
              type="number"
              min={2}
              max={256}
              value={maxCategories}
              onChange={(e) => onSetMaxCategories(Math.max(2, Math.min(256, Number(e.target.value))))}
              className="h-6 w-14 rounded border border-border bg-input px-1.5 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
        </>
      ) : null}

      {colorByColumn && colorMode === "continuous" ? (
        <>
          <div className="h-4 w-px bg-border-subtle" />
          <label className="flex items-center gap-1.5">
            <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">Colormap</span>
            <CompactSelect
              value={continuousColormap}
              options={continuousColormaps.map((c) => ({ value: c, label: c }))}
              onChange={onSetContinuousColormap}
            />
          </label>
        </>
      ) : null}

      {loadingKey ? (
        <span className="animate-pulse text-[11px] text-accent-amber italic">
          loading {loadingKey.replace(/^X_/, "")}...
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        <ToggleGroup
          value={selectionTool === "pan" ? [] : [selectionTool]}
          onValueChange={(v: string[]) => onSetSelectionTool((v[v.length - 1] as "marquee" | "lasso") ?? "pan")}
          className="gap-0"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <ToggleGroupItem value="marquee" size="sm" className="size-6">
                  <BoxSelect data-icon />
                </ToggleGroupItem>
              }
            />
            <TooltipContent side="bottom">Rectangle select (Shift+drag)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <ToggleGroupItem value="lasso" size="sm" className="size-6">
                  <LassoSelect data-icon />
                </ToggleGroupItem>
              }
            />
            <TooltipContent side="bottom">Lasso select (Shift+Alt+drag)</TooltipContent>
          </Tooltip>
        </ToggleGroup>

        <Separator orientation="vertical" className="mx-0.5 h-4" />

        <Tooltip>
          <TooltipTrigger>
            <Button variant="ghost" size="xs" className="size-6 px-0" onClick={toggleViewLock}>
              {isLinked ? <Lock data-icon /> : <LockOpen data-icon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{isLinked ? "Unlink views" : "Link views"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
