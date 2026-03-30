import { useEffect, useState } from "react";
import { useScatterUIDispatch } from "@/providers/ScatterUIStateProvider";
import { ChevronDownIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useGeneSearch } from "@/scatter-gpu/hooks/useGeneSearch";
import { useLayerNames } from "@/scatter-gpu/hooks/useLayerNames";
import { useGeneColumn } from "@/scatter-gpu/hooks/useGeneColumn";

// ── Var column name encoding ──────────────────────────────────────────────────
// Non-alphanumeric characters become underscores.
// Format: __var_{var}_{layer}__

interface ParsedVarColumn {
  varName: string;
  layer: string;
}

function parseVarColumn(col: string): ParsedVarColumn | null {
  const match = col.match(/^__var_(.+)_([^_]+)__$/);
  if (!match) return null;
  return { varName: match[1], layer: match[2] };
}

function isVarColumn(col: string): boolean {
  return col.startsWith("__var_") && col.endsWith("__");
}

// ── Trigger label helpers ─────────────────────────────────────────────────────

function ObsBadge() {
  return (
    <span className="shrink-0 rounded-sm border border-blue-500/30 bg-blue-500/20 px-1 font-sans text-[9px] leading-none text-blue-400">
      obs
    </span>
  );
}

function VarBadge({ layer }: { layer: string }) {
  return (
    <span className="shrink-0 rounded-sm border border-emerald-500/30 bg-emerald-500/20 px-1 font-sans text-[9px] leading-none text-emerald-400">
      {layer}
    </span>
  );
}

// ── Tab button ────────────────────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-sm px-2 py-0.5 text-xs font-medium transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ColorSourcePickerProps {
  colorByColumn: string | null;
  obsColumns: string[];
  /** Whether the dataset has a var/expression matrix. Hides the Var tab when false. */
  hasVar?: boolean;
  onSetColorByColumn: (col: string | null) => void;
  /** Glass-override for the trigger button className */
  triggerClassName?: string;
  contentClassName?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ColorSourcePicker({
  colorByColumn,
  obsColumns,
  hasVar = false,
  onSetColorByColumn,
  triggerClassName,
  contentClassName,
}: ColorSourcePickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"obs" | "var">("obs");
  const [varQuery, setVarQuery] = useState("");
  const [selectedLayer, setSelectedLayer] = useState("X");

  const { names, isLoading: varsLoading } = useGeneSearch(varQuery);
  const layers = useLayerNames();
  const { setStatus } = useScatterUIDispatch();
  const { materialize, status: varStatus, column: varColumn } = useGeneColumn({ onStatus: setStatus });

  // When var materialization completes, propagate the column and close.
  useEffect(() => {
    if (varStatus === "ready" && varColumn) {
      onSetColorByColumn(varColumn);
      setOpen(false);
    }
  }, [varStatus, varColumn, onSetColorByColumn]);

  // Ensure selectedLayer stays valid when layers load.
  useEffect(() => {
    if (layers.length > 0 && !layers.includes(selectedLayer)) {
      setSelectedLayer(layers[0]);
    }
  }, [layers, selectedLayer]);

  // ── Trigger display ──────────────────────────────────────────────────────────
  let triggerContent: React.ReactNode;
  if (!colorByColumn) {
    triggerContent = <span className="flex-1 truncate text-left text-muted-foreground">— none</span>;
  } else if (isVarColumn(colorByColumn)) {
    const parsed = parseVarColumn(colorByColumn);
    triggerContent = (
      <>
        <span className="flex-1 truncate text-left font-mono">{parsed?.varName ?? colorByColumn}</span>
        {parsed && <VarBadge layer={parsed.layer} />}
      </>
    );
  } else {
    triggerContent = (
      <>
        <span className="flex-1 truncate text-left">{colorByColumn}</span>
        <ObsBadge />
      </>
    );
  }

  // ── Var selection handler ────────────────────────────────────────────────────
  function handleVarSelect(varName: string) {
    materialize(varName, selectedLayer);
    // Popover stays open while loading (useEffect closes it on "ready")
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-expanded={open}
        className={cn(
          "flex h-7 min-w-0 items-center justify-between gap-1.5 rounded-md border border-input bg-input/20 px-2 text-xs/relaxed whitespace-nowrap outline-none transition-colors",
          "hover:bg-input/40 focus-visible:ring-2 focus-visible:ring-ring/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "dark:bg-input/30",
          triggerClassName,
        )}
      >
        {triggerContent}
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent className={cn("w-64 gap-0 p-0", contentClassName)} side="bottom" align="start" sideOffset={4}>
        {/* Tab switcher — Var tab only shown when dataset has expression data */}
        <div className="flex gap-1 border-b border-border p-1">
          <TabButton active={tab === "obs"} onClick={() => setTab("obs")}>
            Obs
          </TabButton>
          {hasVar && (
            <TabButton active={tab === "var"} onClick={() => setTab("var")}>
              Var
            </TabButton>
          )}
        </div>

        {/* ── Obs tab ── */}
        {tab === "obs" && (
          <Command>
            <CommandInput placeholder="Search columns…" />
            <CommandList>
              <CommandEmpty>No columns found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value=""
                  onSelect={() => {
                    onSetColorByColumn(null);
                    setOpen(false);
                  }}
                >
                  <span className="text-muted-foreground">— none</span>
                </CommandItem>
                {obsColumns.map((col) => (
                  <CommandItem
                    key={col}
                    value={col}
                    onSelect={() => {
                      onSetColorByColumn(col);
                      setOpen(false);
                    }}
                  >
                    {col}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}

        {/* ── Var tab ── */}
        {tab === "var" && (
          <>
            {/* Server-side search — disable cmdk's own filtering */}
            <Command shouldFilter={false}>
              <CommandInput value={varQuery} onValueChange={setVarQuery} placeholder="Search var…" />
              <CommandList>
                {varsLoading && <div className="py-4 text-center text-xs text-muted-foreground">Loading…</div>}
                {!varsLoading && names.length === 0 && <CommandEmpty>No var found.</CommandEmpty>}
                {!varsLoading && names.length > 0 && (
                  <CommandGroup>
                    {names.map((varName) => (
                      <CommandItem
                        key={varName}
                        value={varName}
                        onSelect={() => handleVarSelect(varName)}
                        disabled={varStatus === "loading"}
                      >
                        <span className="font-mono">{varName}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>

            {/* Layer chips — always shown; clicking re-materializes if a var is active */}
            <div className="flex flex-wrap gap-1 border-t border-border p-2">
              {layers.map((layer) => (
                <button
                  key={layer}
                  type="button"
                  onClick={() => {
                    setSelectedLayer(layer);
                    const active = colorByColumn ? parseVarColumn(colorByColumn) : null;
                    if (active && layer !== active.layer) {
                      materialize(active.varName, layer);
                    }
                  }}
                  className={cn(
                    "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                    selectedLayer === layer
                      ? "border-primary/50 bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
                  )}
                >
                  {layer}
                </button>
              ))}
            </div>

            {/* Errors shown inline; loading state is in the bottom dock */}
            {varStatus === "error" && (
              <div className="border-t border-border px-3 py-2 text-xs text-destructive">Failed to load var.</div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
