/**
 * One well, laid out as its physical grid of fields.
 *
 * Each cell is a whole-FOV crop wrapped in a container whose OUTLINE carries the
 * `goodness` label — green good, yellow neutral, red bad, grey unlabeled. Colouring the
 * container rather than dimming or hiding the image keeps every field visible and the
 * grid's shape fixed, which is what makes plate-scale effects (a dud well, a bad edge)
 * legible at a glance.
 *
 * Cells are sized in PIXELS, not fractions. A `1fr` track divides whatever width the tile
 * happens to have, so three 7x7 wells in a short tile collapse to ~15px and the images
 * become useless. A fixed cell size keeps them readable and lets the container scroll
 * instead; `cellPx` is the node's zoom control.
 *
 * Clicking a cell selects it. Label the selected field or selection with keys 1/2/3/0.
 */

import { memo } from "react";
import { cn } from "@ndea/ui/lib/utils";
import type { ChannelDef, ChannelHash } from "../gallery/contracts";
import { useGalleryCropQuery } from "../gallery/useGalleryCropQuery";
import { GOODNESS_OUTLINE, type Goodness } from "./goodness";
import type { PlateWell } from "./plate-grid";
import type { PlateFov } from "./usePlateFovs";

interface CellProps {
  fov: PlateFov;
  channels: readonly ChannelDef[];
  hash: ChannelHash;
  viewerZ: number;
  half: number | null;
  size: number | null;
  cellPx: number;
  isFocused: boolean;
  isSelected: boolean;
  /** Corner caption: the field id, or "#rank score" when ranked. */
  caption: string;
  // Take the fov, not a closure over it: an inline `() => onSelect(fov)` is a new function
  // every render, which would defeat the memo below.
  onSelect: (fov: PlateFov, modifiers: { shift: boolean; toggle: boolean }) => void;
}

const PlateCellView = memo(function PlateCellView({
  fov,
  channels,
  hash,
  viewerZ,
  half,
  size,
  cellPx,
  isFocused,
  isSelected,
  caption,
  onSelect,
}: CellProps) {
  const { data } = useGalleryCropQuery({
    fovName: fov.fovName,
    datasetKey: fov.datasetKey,
    frame: { t: fov.t, rowIndex: fov.rowIndex },
    channels,
    hash,
    viewerZ,
    half,
    size,
    enabled: !!fov.fovName && channels.length > 0,
  });

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-sm border-2 bg-black transition-colors",
        GOODNESS_OUTLINE[fov.goodness],
        // Selected members get a ring; the anchor gets a brighter one, so it is clear which
        // cell a shift-range will extend from.
        isSelected && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
        isFocused && "ring-2 ring-primary ring-offset-1 ring-offset-background",
      )}
      style={{ width: cellPx, height: cellPx }}
    >
      <button
        type="button"
        title={`${fov.fovName} — ${fov.goodness}`}
        aria-label={`${fov.fovName}, ${fov.goodness}`}
        onClick={(event) => onSelect(fov, { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey })}
        className="absolute inset-0 h-full w-full cursor-pointer"
      >
        {data?.url ? (
          <img src={data.url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full animate-pulse bg-muted/20" />
        )}
      </button>

      {cellPx >= 44 && (
        <span className="pointer-events-none absolute top-0 right-0 bg-black/55 px-0.5 font-mono text-[8px] text-white/70 leading-none">
          {caption}
        </span>
      )}
    </div>
  );
});

/**
 * The fields of one well in the order they are drawn.
 *
 * Exported because shift-ranges must follow exactly this order — deriving it twice would let
 * the selection and the render drift apart, and a range that selects something other than
 * what looks contiguous is worse than no range at all.
 */
export function orderWellFovs(
  well: PlateWell,
  byFovName: ReadonlyMap<string, PlateFov>,
  layout: "plate" | "ranked",
): PlateFov[] {
  const present = well.cells.map((cell) => byFovName.get(cell.fovName)).filter((f): f is PlateFov => f != null);
  if (layout === "plate") return present;
  // Best first; unscored fields sink rather than sorting as zero.
  return present.toSorted((a, b) => {
    if (a.rankValue == null && b.rankValue == null) return 0;
    if (a.rankValue == null) return 1;
    if (b.rankValue == null) return -1;
    return b.rankValue - a.rankValue;
  });
}

export interface PlateWellGridProps {
  well: PlateWell;
  byFovName: ReadonlyMap<string, PlateFov>;
  channels: readonly ChannelDef[];
  hash: ChannelHash;
  viewerZ: number;
  half: number | null;
  size: number | null;
  cellPx: number;
  /** "plate" places cells at their grid position; "ranked" orders them best-first. */
  layout: "plate" | "ranked";
  focusedRowIndex: number | null;
  /** Multi-selection; these render with a selected ring and label as a batch. */
  selected: ReadonlySet<number>;
  onSelect: (fov: PlateFov, modifiers: { shift: boolean; toggle: boolean }) => void;
}

export function PlateWellGrid({
  well,
  byFovName,
  channels,
  hash,
  viewerZ,
  half,
  size,
  cellPx,
  layout,
  focusedRowIndex,
  selected,
  onSelect,
}: PlateWellGridProps) {
  const counts: Record<Goodness, number> = { good: 0, neutral: 0, bad: 0, unlabeled: 0 };
  const byPosition = new Map<string, PlateFov>();
  const present: PlateFov[] = [];
  for (const cell of well.cells) {
    const fov = byFovName.get(cell.fovName);
    if (!fov) continue;
    counts[fov.goodness] += 1;
    byPosition.set(`${cell.row}:${cell.col}`, fov);
    present.push(fov);
  }

  const ranked = orderWellFovs(well, byFovName, "ranked");

  return (
    <section className="flex flex-none flex-col gap-1">
      <header className="flex items-baseline gap-2 px-0.5">
        <h3 className="font-mono text-2xs text-foreground/80">{well.well}</h3>
        <span className="font-mono text-[9px] text-muted-foreground/70">
          {well.rows}×{well.cols}
        </span>
        <span className="ml-auto flex gap-1.5 font-mono text-[9px]">
          <span className="text-success">{counts.good}</span>
          <span className="text-warning">{counts.neutral}</span>
          <span className="text-destructive">{counts.bad}</span>
          <span className="text-muted-foreground/60">{counts.unlabeled}</span>
        </span>
      </header>
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${well.cols}, ${cellPx}px)` }}>
        {layout === "ranked"
          ? ranked.map((fov, i) => (
              <PlateCellView
                key={fov.fovName}
                fov={fov}
                channels={channels}
                hash={hash}
                viewerZ={viewerZ}
                half={half}
                size={size}
                cellPx={cellPx}
                caption={fov.rankValue == null ? `#${i + 1}` : `#${i + 1} ${fov.rankValue.toFixed(4)}`}
                isFocused={focusedRowIndex === fov.rowIndex}
                isSelected={selected.has(fov.rowIndex)}
                onSelect={onSelect}
              />
            ))
          : Array.from({ length: well.rows * well.cols }, (_cell, i) => {
              const row = Math.floor(i / well.cols);
              const col = i % well.cols;
              const fov = byPosition.get(`${row}:${col}`);
              if (!fov) {
                // A hole in a partial acquisition: hold the slot so the grid keeps its shape.
                return (
                  <div
                    key={`${row}-${col}`}
                    className="rounded-sm bg-muted/10"
                    style={{ width: cellPx, height: cellPx }}
                  />
                );
              }
              return (
                <PlateCellView
                  key={fov.fovName}
                  fov={fov}
                  channels={channels}
                  hash={hash}
                  viewerZ={viewerZ}
                  half={half}
                  size={size}
                  cellPx={cellPx}
                  caption={fov.fovName.slice(fov.fovName.lastIndexOf("/") + 1)}
                  isFocused={focusedRowIndex === fov.rowIndex}
                  isSelected={selected.has(fov.rowIndex)}
                  onSelect={onSelect}
                />
              );
            })}
      </div>
    </section>
  );
}
