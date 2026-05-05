/**
 * Sketch C — Floating glass inspector
 *
 * Lasso ends → glass panel floats over the scatter, anchored to the
 * lasso bounds. FOV-grouped accordion sections so spatial provenance
 * stays visible. Draggable, dock-to-side option, dismissable.
 *
 * Best for: spatially-rich selections that span multiple wells/FOVs.
 * Tradeoff: occludes part of the scatter; not ideal for "compare back"
 * workflows where you want to keep both visible at once.
 */

import { ChevronDown, ChevronRight, GripVertical, PanelRight, Pin, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { cn } from "@/lib/utils";
import { FauxScatter } from "./FauxScatter";
import { CATEGORY_COLORS, generateMockSelection, groupByFov, synthCropUrl, type MockObs } from "./sketch-data";

export function SketchC_FloatingInspector() {
  const [open, setOpen] = useState(true);
  const obs = useMemo(() => generateMockSelection(247), []);
  const groups = useMemo(() => groupByFov(obs), [obs]);
  const sortedGroupKeys = useMemo(
    () => Array.from(groups.keys()).sort((a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0)),
    [groups],
  );

  return (
    <div className="relative h-full w-full bg-base">
      <FauxScatter className="absolute inset-0" showLasso selectionCount={247} />

      {!open && (
        <div className="absolute right-4 top-4 z-20">
          <Button variant="default" size="sm" onClick={() => setOpen(true)}>
            Show inspector ({obs.length})
          </Button>
        </div>
      )}

      {open && (
        <FloatingInspector
          fovGroups={groups}
          fovOrder={sortedGroupKeys}
          total={obs.length}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function FloatingInspector({
  fovGroups,
  fovOrder,
  total,
  onClose,
}: {
  fovGroups: Map<string, MockObs[]>;
  fovOrder: string[];
  total: number;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  return (
    <div
      className={cn(
        "absolute top-3 right-3 z-30 flex w-[440px] max-h-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg",
        "border border-glass-border bg-glass-bg backdrop-blur-[var(--blur-glass)] backdrop-saturate-150 shadow-lg shadow-black/30",
      )}
    >
      {/* Title bar */}
      <div className="flex h-8 shrink-0 cursor-grab items-center gap-1.5 border-glass-border/60 border-b px-2 select-none active:cursor-grabbing">
        <GripVertical className="size-3 text-muted-foreground" />
        <span className="font-medium text-foreground/90 text-xs">Selection inspector</span>
        <Badge variant="outline" className="font-mono text-[10px]">
          {total} obs · {fovGroups.size} FOVs
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-xs">
                  <PanelRight />
                </Button>
              }
            />
            <TooltipContent>Dock to side</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-xs" onClick={onClose}>
                  <X />
                </Button>
              }
            />
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Channel sync status — connects to viewer */}
      <div className="flex shrink-0 items-center gap-1.5 border-glass-border/60 border-b px-2 py-1 bg-emphasis/30">
        <span className="size-1.5 rounded-full bg-success-hue" />
        <span className="text-foreground/70 text-3xs">channels synced from viewer</span>
        <span className="ml-auto font-mono text-muted-foreground/70 text-3xs">DAPI · GFP · mCherry</span>
      </div>

      {/* FOV-grouped body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {fovOrder.map((fov) => {
          const items = fovGroups.get(fov) ?? [];
          const isCollapsed = collapsed.has(fov);
          return (
            <div key={fov} className="border-glass-border/40 border-b last:border-b-0">
              <button
                type="button"
                onClick={() => {
                  const next = new Set(collapsed);
                  if (isCollapsed) next.delete(fov);
                  else next.add(fov);
                  setCollapsed(next);
                }}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-muted/30"
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3 text-muted-foreground" />
                )}
                <span className="font-mono text-foreground/90 text-2xs">{fov}</span>
                <span className="text-muted-foreground/70 text-3xs">({items.length})</span>
                <CategoryDots items={items} className="ml-auto" />
              </button>

              {!isCollapsed && (
                <div className="grid grid-cols-4 gap-1 px-2 pb-2">
                  {items.slice(0, 16).map((o) => (
                    <InspectorCropCard key={o.rowIndex} obs={o} />
                  ))}
                  {items.length > 16 && (
                    <div className="col-span-4 pb-1 text-center text-muted-foreground/60 text-3xs">
                      + {items.length - 16} more in this FOV
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center gap-2 border-glass-border/60 border-t bg-base/30 px-2 py-1.5">
        <Button variant="outline" size="xs">
          <Pin className="size-2.5" data-icon="inline-start" />
          Save as obsset
        </Button>
        <Button variant="ghost" size="xs">
          Export
        </Button>
        <span className="ml-auto font-mono text-muted-foreground text-3xs">click crop → image viewer</span>
      </div>
    </div>
  );
}

function CategoryDots({ items, className }: { items: MockObs[]; className?: string }) {
  const counts = items.reduce<Record<MockObs["category"], number>>(
    (acc, o) => {
      acc[o.category] = (acc[o.category] ?? 0) + 1;
      return acc;
    },
    { infected: 0, uninfected: 0, dead: 0, mitotic: 0 },
  );
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {(Object.entries(counts) as [MockObs["category"], number][])
        .filter(([, n]) => n > 0)
        .map(([cat, n]) => (
          <span key={cat} className="flex items-center gap-0.5">
            <span className="size-1.5 rounded-full" style={{ background: CATEGORY_COLORS[cat] }} />
            <span className="font-mono text-3xs text-muted-foreground">{n}</span>
          </span>
        ))}
    </div>
  );
}

function InspectorCropCard({ obs }: { obs: MockObs }) {
  const url = synthCropUrl(obs);
  return (
    <button
      type="button"
      className="group relative aspect-square overflow-hidden rounded-sm border border-border/40 bg-black transition-all hover:border-primary/60 hover:scale-[1.04]"
    >
      <img src={url} alt={obs.fov} className="absolute inset-0 h-full w-full object-cover" />
      <div
        className="absolute top-0.5 left-0.5 size-1.5 rounded-full ring-1 ring-black/40"
        style={{ background: CATEGORY_COLORS[obs.category] }}
      />
      <div className="absolute right-0.5 bottom-0.5 rounded-sm bg-black/70 px-1 font-mono text-[8px] text-white/90 backdrop-blur-sm">
        T{obs.t}
      </div>
    </button>
  );
}
