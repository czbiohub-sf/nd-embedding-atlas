import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, CircleCheckIcon, CircleDashedIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface ObsmEntry {
  prefix: string;
  n_dims: number | null;
  loaded: boolean;
  modality?: string;
}

export interface EmbeddingPickerProps {
  obsm: Record<string, ObsmEntry>;
  activeKey: string;
  onSelect: (key: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip "X_" prefix for display, e.g. "rna:X_umap" → "rna:umap" */
function displayName(key: string): string {
  return key.replace(/X_/g, "");
}

/** Group obsm entries by modality. Entries without modality go into "default". */
function groupByModality(obsm: Record<string, ObsmEntry>): Map<string, [string, ObsmEntry][]> {
  const groups = new Map<string, [string, ObsmEntry][]>();
  for (const [key, entry] of Object.entries(obsm)) {
    const mod = entry.modality ?? "default";
    if (!groups.has(mod)) groups.set(mod, []);
    groups.get(mod)!.push([key, entry]);
  }
  return groups;
}

// ── Modality colors ──────────────────────────────────────────────────────────

const MODALITY_COLORS: Record<string, string> = {
  rna: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
  dinov2: "border-violet-500/30 bg-violet-500/15 text-violet-400",
  protein: "border-amber-500/30 bg-amber-500/15 text-amber-400",
  atac: "border-rose-500/30 bg-rose-500/15 text-rose-400",
  default: "border-border-subtle bg-elevated text-text-secondary",
};

function modalityColor(mod: string): string {
  return MODALITY_COLORS[mod] ?? MODALITY_COLORS.default;
}

// ── Component ────────────────────────────────────────────────────────────────

export function EmbeddingPicker({ obsm, activeKey, onSelect }: EmbeddingPickerProps) {
  const [open, setOpen] = useState(false);
  const groups = groupByModality(obsm);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex h-7 min-w-0 items-center justify-between gap-1.5 whitespace-nowrap rounded-md",
          "border border-input bg-input/20 px-2 text-xs/relaxed outline-none transition-colors",
          "hover:bg-input/40 focus-visible:ring-2 focus-visible:ring-ring/30",
          "dark:bg-input/30",
        )}
      >
        <span className="flex-1 truncate text-left font-mono">{displayName(activeKey)}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent className="w-72 gap-0 p-0" side="bottom" align="start" sideOffset={4}>
        <ScrollArea className="max-h-80">
          <div className="p-1.5">
            {[...groups.entries()].map(([mod, entries]) => (
              <ModalityGroup
                key={mod}
                modality={mod}
                entries={entries}
                activeKey={activeKey}
                onSelect={(key) => {
                  onSelect(key);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// ── Modality group ───────────────────────────────────────────────────────────

function ModalityGroup({
  modality,
  entries,
  activeKey,
  onSelect,
}: {
  modality: string;
  entries: [string, ObsmEntry][];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs",
          "text-text-secondary hover:bg-elevated transition-colors",
        )}
      >
        <ChevronRightIcon className="size-3 shrink-0 transition-transform [[data-open]>&]:rotate-90" />
        <Badge variant="outline" className={cn("text-[9px]", modalityColor(modality))}>
          {modality}
        </Badge>
        <span className="ml-auto text-text-muted text-[10px]">{entries.length}</span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-3 border-border-subtle border-l pl-2">
          {entries.map(([key, entry]) => (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                key === activeKey
                  ? "bg-primary/10 text-primary-foreground"
                  : "text-text-secondary hover:bg-elevated hover:text-text-primary",
              )}
            >
              {entry.loaded ? (
                <CircleCheckIcon className="size-3 shrink-0 text-emerald-400" />
              ) : (
                <CircleDashedIcon className="size-3 shrink-0 text-text-muted" />
              )}
              <span className="flex-1 truncate font-mono">{displayName(key)}</span>
              {entry.n_dims != null && <span className="shrink-0 text-text-muted text-[10px]">{entry.n_dims}d</span>}
            </button>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
