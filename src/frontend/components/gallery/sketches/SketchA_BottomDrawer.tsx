/**
 * Sketch A — Bottom drawer
 *
 * Lasso ends → drawer slides up from below scatter.
 * Compact "peek" mode by default (180px), expandable to full-half (60vh).
 * Dismissable. Sort + group controls in header.
 *
 * Best for: quick scan, then return to scatter.
 * Tradeoff: takes vertical real estate from other panels when expanded.
 */

import { ChevronDown, ChevronUp, GripHorizontal, X, Group, ArrowUpDown, Maximize2, ImageDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { cn } from "@/lib/utils";
import { FauxScatter } from "./FauxScatter";
import { CATEGORY_COLORS, generateMockSelection, synthCropUrl, type MockObs } from "./sketch-data";

type SortKey = "embedding-distance" | "fov" | "category" | "time";

export function SketchA_BottomDrawer() {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(true);
  const [selectionCount, setSelectionCount] = useState(247);
  const [sortKey, setSortKey] = useState<SortKey>("embedding-distance");
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const obs = useMemo(() => generateMockSelection(selectionCount), [selectionCount]);
  const sortedObs = useMemo(() => {
    const list = [...obs];
    if (sortKey === "embedding-distance") list.sort((a, b) => a.embeddingDistance - b.embeddingDistance);
    else if (sortKey === "fov") list.sort((a, b) => a.fov.localeCompare(b.fov));
    else if (sortKey === "category") list.sort((a, b) => a.category.localeCompare(b.category));
    else if (sortKey === "time") list.sort((a, b) => a.t - b.t);
    return list;
  }, [obs, sortKey]);

  const fovCount = useMemo(() => new Set(obs.map((o) => o.fov)).size, [obs]);
  const drawerHeight = open ? (expanded ? "60vh" : "200px") : "32px";

  return (
    <div className="relative flex h-full w-full flex-col bg-base">
      {/* Faux scatter occupying everything above the drawer */}
      <div className="flex-1 min-h-0 relative">
        <FauxScatter className="absolute inset-0" showLasso selectionCount={selectionCount} />
        <SimSelectionControl count={selectionCount} setCount={setSelectionCount} />
      </div>

      {/* Drawer */}
      <div
        className="border-border-subtle border-t bg-card transition-[height] duration-200 ease-out flex flex-col shrink-0"
        style={{ height: drawerHeight }}
      >
        {/* Drawer header — always visible */}
        <div className="flex h-8 shrink-0 items-center gap-2 border-border-subtle/60 border-b px-2 select-none">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted/50"
            aria-label={open ? "Collapse" : "Expand"}
          >
            <GripHorizontal className="size-3" />
          </button>
          <span className="font-medium text-foreground/90 text-xs">Lasso selection</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {sortedObs.length} obs · {fovCount} FOVs
          </Badge>

          {open && (
            <>
              <span className="mx-1 h-3 w-px bg-border-subtle" />
              <SortControl value={sortKey} onChange={setSortKey} />
              <Button variant="ghost" size="xs">
                <Group className="size-2.5" data-icon="inline-start" />
                Group
              </Button>
              <Button variant="ghost" size="xs">
                <ImageDown className="size-2.5" data-icon="inline-start" />
                Export
              </Button>
            </>
          )}

          <div className="ml-auto flex items-center gap-1">
            {open && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon-xs" onClick={() => setExpanded((e) => !e)}>
                      {expanded ? <ChevronDown /> : <ChevronUp />}
                    </Button>
                  }
                />
                <TooltipContent>{expanded ? "Compact" : "Expand"}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-xs" onClick={() => setOpen(false)}>
                    <X />
                  </Button>
                }
              />
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Drawer body — virtualized in real impl */}
        {open && (
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
              {sortedObs.slice(0, 80).map((o) => (
                <CropCard key={o.rowIndex} obs={o} hovered={hoveredId === o.rowIndex} onHover={setHoveredId} />
              ))}
              {sortedObs.length > 80 && (
                <div className="col-span-full text-center text-muted-foreground/60 text-3xs">
                  + {sortedObs.length - 80} more (real impl will virtualize)
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SimSelectionControl({ count, setCount }: { count: number; setCount: (n: number) => void }) {
  return (
    <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-glass-border bg-glass-bg px-2 py-1 backdrop-blur-md">
      <span className="text-muted-foreground text-3xs">sim N=</span>
      <input
        type="number"
        value={count}
        onChange={(e) => setCount(Math.max(1, Math.min(2000, Number(e.target.value) || 0)))}
        className="w-16 bg-transparent font-mono text-foreground text-3xs outline-none"
      />
    </div>
  );
}

function SortControl({ value, onChange }: { value: SortKey; onChange: (k: SortKey) => void }) {
  const options: { key: SortKey; label: string }[] = [
    { key: "embedding-distance", label: "embedding distance" },
    { key: "fov", label: "FOV" },
    { key: "category", label: "category" },
    { key: "time", label: "time" },
  ];
  return (
    <div className="flex items-center gap-1">
      <ArrowUpDown className="size-2.5 text-muted-foreground" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        className="bg-transparent text-foreground/80 text-2xs"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CropCard({ obs, hovered, onHover }: { obs: MockObs; hovered: boolean; onHover: (id: number | null) => void }) {
  const url = synthCropUrl(obs);
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(obs.rowIndex)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-md border bg-background text-left transition-colors",
        hovered ? "border-primary/70" : "border-border/40 hover:border-border/70",
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-black">
        <img src={url} alt={obs.fov} className="absolute inset-0 h-full w-full object-cover" />
        <div
          className="absolute top-1 left-1 size-1.5 rounded-full"
          style={{ background: CATEGORY_COLORS[obs.category] }}
        />
        <div className="absolute right-1 bottom-1 rounded bg-black/60 px-1 py-0.5 font-mono text-[8px] text-white/80 backdrop-blur-sm">
          d={obs.embeddingDistance.toFixed(2)}
        </div>
        {hovered && (
          <div className="absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/70 to-transparent p-1.5">
            <Maximize2 className="size-3 text-white/90" />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 px-1.5 py-1">
        <span className="truncate font-mono text-foreground/70 text-[10px]">{obs.fov}</span>
        <span className="font-mono text-muted-foreground/70 text-[9px]">T{obs.t}</span>
      </div>
    </button>
  );
}
