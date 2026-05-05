/**
 * Sketch B — Side-docked workspace panel
 *
 * Persistent right column. Shows empty state until a lasso fires, then
 * fills with crops. Scatter on the left, gallery on the right — both
 * are first-class workspace surfaces.
 *
 * Includes:
 *  - sticky header with selection summary + clear
 *  - filter pills (per-category, per-FOV-well)
 *  - sortable grid (size knob: small / medium / large)
 *  - "send to inspector" action per crop
 *
 * Best for: "lasso → review → re-lasso" iterative workflow.
 * Tradeoff: always-on column eats horizontal space (~360px min).
 */

import {
  Filter,
  GalleryHorizontalEnd,
  Grid2x2,
  Grid3x3,
  LayoutGrid,
  Pin,
  SquareDashedMousePointer,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { cn } from "@/lib/utils";
import { FauxScatter } from "./FauxScatter";
import { CATEGORY_COLORS, generateMockSelection, synthCropUrl, type MockObs } from "./sketch-data";

type Density = "sm" | "md" | "lg";

const DENSITY_PX: Record<Density, number> = { sm: 80, md: 120, lg: 180 };

const DENSITY_OPTIONS: { key: Density; Icon: LucideIcon; label: string }[] = [
  { key: "sm", Icon: Grid3x3, label: "Small" },
  { key: "md", Icon: Grid2x2, label: "Medium" },
  { key: "lg", Icon: LayoutGrid, label: "Large" },
];

export function SketchB_DockPanel() {
  const [hasSelection, setHasSelection] = useState(true);
  const [density, setDensity] = useState<Density>("md");
  const [excludedCategories, setExcludedCategories] = useState<Set<MockObs["category"]>>(new Set());
  const [pinned, setPinned] = useState<Set<number>>(new Set());

  const obs = useMemo(() => generateMockSelection(247), []);
  const filtered = useMemo(
    () =>
      obs.filter((o) => !excludedCategories.has(o.category)).sort((a, b) => a.embeddingDistance - b.embeddingDistance),
    [obs, excludedCategories],
  );

  const wellCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of filtered) counts[o.well] = (counts[o.well] ?? 0) + 1;
    return counts;
  }, [filtered]);

  const categoryCounts = useMemo(() => {
    const counts: Record<MockObs["category"], number> = {
      infected: 0,
      uninfected: 0,
      dead: 0,
      mitotic: 0,
    };
    for (const o of obs) counts[o.category]++;
    return counts;
  }, [obs]);

  return (
    <div className="flex h-full w-full bg-base">
      {/* Scatter column */}
      <div className="relative flex-1 min-w-0">
        <FauxScatter className="absolute inset-0" showLasso={hasSelection} selectionCount={247} />
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-glass-border bg-glass-bg px-2 py-1 backdrop-blur-md">
          <Button variant={hasSelection ? "default" : "outline"} size="xs" onClick={() => setHasSelection((s) => !s)}>
            <SquareDashedMousePointer className="size-2.5" data-icon="inline-start" />
            {hasSelection ? "Lasso active" : "Simulate lasso"}
          </Button>
        </div>
      </div>

      {/* Gallery dock */}
      <div className="flex w-[380px] shrink-0 flex-col border-border-subtle border-l bg-card">
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-border-subtle/60 border-b px-2">
          <GalleryHorizontalEnd className="size-3 text-muted-foreground" />
          <span className="font-medium text-foreground/90 text-xs">Lasso gallery</span>
          {hasSelection && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {filtered.length}/{obs.length}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-0.5 rounded-md border border-border/40 p-0.5">
            {DENSITY_OPTIONS.map(({ key, Icon, label }) => (
              <button
                key={key}
                type="button"
                aria-label={label}
                onClick={() => setDensity(key)}
                className={cn(
                  "flex size-5 items-center justify-center rounded-sm transition-colors",
                  density === key
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                <Icon className="size-2.5" />
              </button>
            ))}
          </div>
        </div>

        {!hasSelection ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <SquareDashedMousePointer className="size-6 text-muted-foreground/40" />
            <div className="font-medium text-foreground/70 text-xs">No selection</div>
            <div className="text-muted-foreground/60 text-2xs">
              Lasso a region in the scatter to populate the gallery.
            </div>
          </div>
        ) : (
          <>
            {/* Category filter pills */}
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-border-subtle/60 border-b px-2 py-1.5">
              <Filter className="mr-0.5 size-2.5 text-muted-foreground" />
              {(Object.keys(categoryCounts) as MockObs["category"][]).map((cat) => {
                const excluded = excludedCategories.has(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      const next = new Set(excludedCategories);
                      if (excluded) next.delete(cat);
                      else next.add(cat);
                      setExcludedCategories(next);
                    }}
                    className={cn(
                      "flex h-5 items-center gap-1 rounded-full border px-1.5 font-mono text-[10px] transition-colors",
                      excluded
                        ? "border-border/30 bg-transparent text-muted-foreground/40 line-through"
                        : "border-border/60 bg-muted/40 text-foreground/80",
                    )}
                  >
                    <span className="size-1.5 rounded-full" style={{ background: CATEGORY_COLORS[cat] }} />
                    {cat}
                    <span className="text-muted-foreground/60">{categoryCounts[cat]}</span>
                  </button>
                );
              })}
            </div>

            {/* Well distribution strip */}
            <div className="flex shrink-0 items-center gap-1.5 border-border-subtle/60 border-b px-2 py-1.5">
              <span className="text-muted-foreground text-3xs">wells:</span>
              {Object.entries(wellCounts).map(([well, n]) => (
                <span key={well} className="font-mono text-2xs text-foreground/70" title={`${well}: ${n} obs`}>
                  {well}
                  <span className="ml-0.5 text-muted-foreground/50">·{n}</span>
                </span>
              ))}
            </div>

            {/* Pinned strip */}
            {pinned.size > 0 && (
              <div className="flex shrink-0 items-center gap-1 border-border-subtle/60 border-b bg-emphasis/40 px-2 py-1.5">
                <Pin className="size-2.5 text-primary" />
                <span className="text-foreground/70 text-3xs">{pinned.size} pinned</span>
                <Button variant="ghost" size="xs" className="ml-auto text-3xs" onClick={() => setPinned(new Set())}>
                  Clear
                </Button>
              </div>
            )}

            {/* Grid */}
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              <div
                className="grid gap-1.5"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${DENSITY_PX[density]}px, 1fr))`,
                }}
              >
                {filtered.slice(0, 60).map((o) => (
                  <DockCropCard
                    key={o.rowIndex}
                    obs={o}
                    density={density}
                    pinned={pinned.has(o.rowIndex)}
                    onPinToggle={() => {
                      const next = new Set(pinned);
                      if (next.has(o.rowIndex)) next.delete(o.rowIndex);
                      else next.add(o.rowIndex);
                      setPinned(next);
                    }}
                  />
                ))}
                {filtered.length > 60 && (
                  <div className="col-span-full pt-2 text-center text-muted-foreground/50 text-3xs">
                    + {filtered.length - 60} more
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DockCropCard({
  obs,
  density,
  pinned,
  onPinToggle,
}: {
  obs: MockObs;
  density: Density;
  pinned: boolean;
  onPinToggle: () => void;
}) {
  const url = synthCropUrl(obs);
  const showFooter = density !== "sm";
  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded border bg-background transition-colors",
        pinned ? "border-primary/60 ring-1 ring-primary/20" : "border-border/30 hover:border-border/60",
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-black">
        <img src={url} alt={obs.fov} className="absolute inset-0 h-full w-full object-cover" />
        <div
          className="absolute top-1 left-1 size-1.5 rounded-full ring-1 ring-black/30"
          style={{ background: CATEGORY_COLORS[obs.category] }}
        />
        {density === "lg" && (
          <div className="absolute right-1 bottom-1 flex items-center gap-1 rounded bg-black/60 px-1 py-0.5 font-mono text-[8px] text-white/85 backdrop-blur-sm">
            d={obs.embeddingDistance.toFixed(2)}
          </div>
        )}
        <div className="absolute inset-0 flex items-start justify-end bg-gradient-to-t from-transparent to-black/40 p-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={onPinToggle}
                  className="flex size-5 items-center justify-center rounded bg-black/70 text-white/90 backdrop-blur-sm hover:bg-black/85"
                >
                  {pinned ? <X className="size-2.5" /> : <Pin className="size-2.5" />}
                </button>
              }
            />
            <TooltipContent>{pinned ? "Unpin" : "Pin"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {showFooter && (
        <div className="flex items-center justify-between gap-1 px-1.5 py-1">
          <span className="truncate font-mono text-foreground/70 text-[10px]">{obs.fov.split("/")[2]}</span>
          <span className="font-mono text-muted-foreground/60 text-[9px]">T{obs.t}</span>
        </div>
      )}
    </div>
  );
}
