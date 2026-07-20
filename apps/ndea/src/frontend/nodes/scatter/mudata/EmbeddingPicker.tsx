import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getModality, getBareObsmKey } from "@/lib/modality";

// ── Types ────────────────────────────────────────────────────────────────────

interface ObsmEntry {
  prefix: string;
  n_dims?: number | null;
  loaded: boolean;
  modality?: string;
}

export interface EmbeddingPickerProps {
  obsm: Record<string, ObsmEntry>;
  activeKey: string;
  onSelect: (key: string) => void;
  triggerClassName?: string;
  /** Hide the dropdown chevron (compact overlay "chip" trigger). */
  hideChevron?: boolean;
}

// ── Modality colors ──────────────────────────────────────────────────────────

const MODALITY_COLORS: Record<string, string> = {
  rna: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
  dinov2: "border-violet-500/30 bg-violet-500/15 text-violet-400",
  protein: "border-amber-500/30 bg-amber-500/15 text-amber-400",
  atac: "border-rose-500/30 bg-rose-500/15 text-rose-400",
};

function modColor(mod: string): string {
  return MODALITY_COLORS[mod] ?? "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** "rna:X_umap" → "umap", "X_pca" → "pca" */
function bareLabel(key: string): string {
  return getBareObsmKey(key).replace(/^X_/, "");
}

/** Group obsm keys by modality. */
function groupByModality(obsm: Record<string, ObsmEntry>): Map<string, [string, ObsmEntry][]> {
  const groups = new Map<string, [string, ObsmEntry][]>();
  for (const [key, entry] of Object.entries(obsm)) {
    const mod = entry.modality ?? getModality(key) ?? "default";
    if (!groups.has(mod)) groups.set(mod, []);
    groups.get(mod)!.push([key, entry]);
  }
  return groups;
}

// ── Component ────────────────────────────────────────────────────────────────

export function EmbeddingPicker({
  obsm,
  activeKey,
  onSelect,
  triggerClassName,
  hideChevron = false,
}: EmbeddingPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const groups = useMemo(() => groupByModality(obsm), [obsm]);
  const modalities = useMemo(() => [...groups.keys()], [groups]);
  const activeMod = getModality(activeKey);

  // Filter entries by selected modality tab
  const visibleGroups = filter ? new Map([[filter, groups.get(filter) ?? []]]) : groups;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex h-6 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-md",
          "border-0 bg-transparent px-1.5 text-2xs outline-none transition-colors",
          "text-foreground/80 hover:bg-muted hover:text-foreground focus-visible:ring-0",
          triggerClassName,
        )}
      >
        <span className="truncate font-mono">{bareLabel(activeKey)}</span>
        {activeMod && (
          <Badge variant="outline" className={cn("px-1 py-0 text-3xs", modColor(activeMod))}>
            {activeMod}
          </Badge>
        )}
        {!hideChevron && <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />}
      </PopoverTrigger>

      <PopoverContent className="w-56 gap-0 p-0" side="bottom" align="start" sideOffset={4}>
        {/* Modality filter tabs */}
        {modalities.length > 1 && (
          <div className="flex gap-1 border-border border-b px-2 py-1.5">
            <button
              type="button"
              onClick={() => setFilter(null)}
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-3xs transition-colors",
                !filter ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              all
            </button>
            {modalities.map((mod) => (
              <button
                key={mod}
                type="button"
                onClick={() => setFilter(filter === mod ? null : mod)}
                className={cn(
                  "rounded-sm px-1.5 py-0.5 text-3xs transition-colors",
                  filter === mod
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <Badge variant="outline" className={cn("px-1 py-0 text-3xs", modColor(mod))}>
                  {mod}
                </Badge>
              </button>
            ))}
          </div>
        )}

        <ScrollArea className="max-h-64">
          <div className="p-1">
            {[...visibleGroups.entries()].map(([mod, entries]) => {
              const items = entries.map(([key, entry]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onSelect(key);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    key === activeKey
                      ? "bg-primary/15 text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="flex-1 truncate font-mono">{bareLabel(key)}</span>
                  {entry.n_dims != null && (
                    <span className="shrink-0 text-3xs text-muted-foreground">{entry.n_dims}d</span>
                  )}
                  {!entry.loaded && <span className="shrink-0 text-3xs text-muted-foreground/50">load</span>}
                </button>
              ));

              // When filtered to one modality, show flat list
              if (filter) return <div key={mod}>{items}</div>;

              // When "all", wrap each modality in a collapsible
              return (
                <Collapsible key={mod} defaultOpen>
                  <CollapsibleTrigger
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs",
                      "text-muted-foreground hover:bg-muted transition-colors",
                    )}
                  >
                    <ChevronRightIcon className="size-3 shrink-0 transition-transform [[data-open]>&]:rotate-90" />
                    <Badge variant="outline" className={cn("px-1 py-0 text-3xs", modColor(mod))}>
                      {mod}
                    </Badge>
                    <span className="ml-auto text-3xs text-muted-foreground">{entries.length}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-3 border-border border-l pl-1">{items}</div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
