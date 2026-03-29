/**
 * ScatterControlStrip — per-panel embedding/dim/color control bar.
 *
 * Extracted verbatim from ScatterPanel's inline toolbar block.
 * All state and callbacks live in ScatterPanel; this component is pure UI.
 */

import type { ColorMode } from "../../scatter-gpu/hooks/useMosaicScatterData";
import type { AxisState } from "../../types";
import { CompactSelect } from "../ui/select";
import { Button } from "../ui/button";

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
}: ScatterControlStripProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-2 py-1 text-text-secondary">
      <label className="flex items-center gap-1.5">
        <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">
          Embedding
        </span>
        <CompactSelect
          value={axes.obsmKey}
          disabled={loadingKey !== null}
          options={obsmKeys.map((k) => ({ value: k, label: k.replace(/^X_/, "") }))}
          onChange={(v) => onSetAxes({ obsmKey: v, xDim: 0, yDim: 1 })}
        />
      </label>

      <label className="flex items-center gap-1">
        <span className="text-[10px] text-text-muted">X</span>
        <CompactSelect
          value={String(axes.xDim)}
          disabled={loadingKey !== null || !currentEntryLoaded}
          options={dims.map((d) => ({ value: String(d), label: String(d) }))}
          onChange={(v) => onSetAxes({ ...axes, xDim: Number(v) })}
        />
      </label>

      <label className="flex items-center gap-1">
        <span className="text-[10px] text-text-muted">Y</span>
        <CompactSelect
          value={String(axes.yDim)}
          disabled={loadingKey !== null || !currentEntryLoaded}
          options={dims.map((d) => ({ value: String(d), label: String(d) }))}
          onChange={(v) => onSetAxes({ ...axes, yDim: Number(v) })}
        />
      </label>

      <div className="h-4 w-px bg-border-subtle" />

      <label className="flex items-center gap-1.5">
        <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">
          Color
        </span>
        <CompactSelect
          value={colorByColumn ?? ""}
          placeholder="none"
          options={obsColumns.map((col) => ({ value: col, label: col }))}
          onChange={(v) => onSetColorByColumn(v || null)}
        />
      </label>

      {colorModeCanToggle && (
        <Button
          variant="ghost"
          size="xs"
          className="h-6 px-2 text-xs"
          onClick={onToggleColorMode}
        >
          {colorMode === "continuous" ? "scale" : "palette"}
        </Button>
      )}

      {colorByColumn && colorMode === "categorical" ? (
        <>
          <div className="h-4 w-px bg-border-subtle" />
          <label className="flex items-center gap-1.5">
            <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">
              Palette
            </span>
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
              onChange={(e) =>
                onSetMaxCategories(Math.max(2, Math.min(256, Number(e.target.value))))
              }
              className="w-14 h-6 rounded border border-border bg-input px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
        </>
      ) : null}

      {colorByColumn && colorMode === "continuous" ? (
        <>
          <div className="h-4 w-px bg-border-subtle" />
          <label className="flex items-center gap-1.5">
            <span className="font-medium text-[10px] text-text-muted uppercase tracking-wider">
              Colormap
            </span>
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
    </div>
  );
}
