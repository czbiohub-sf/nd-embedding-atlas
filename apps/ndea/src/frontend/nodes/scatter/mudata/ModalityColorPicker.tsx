/**
 * ModalityColorPicker: color source picker with cross-modality support.
 *
 * Key concept: the color source is INDEPENDENT of the active embedding.
 * You can view rna:X_umap while coloring by dinov2:feat_42 because all
 * modalities share the same obs_names (same cells, same __row_index__).
 *
 * Obs tab: shows columns grouped by modality (shared + per-mod sub-tabs)
 * Var tab: modality picker determines which X matrix to search
 */

import { ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useScatterUIDispatch } from "@/nodes/scatter/scatter-ui-store";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  COLOR_NONE,
  type ColorSource,
  colorSourceFromString,
  colorSourceObs,
  isVarSource,
} from "@/lib/color/color-source";
import { getModality } from "@/lib/modality";
import { cn } from "@/lib/utils";
import { useLayerNames } from "@/nodes/scatter/gpu/hooks/useLayerNames";
import { useVarColumn } from "@/nodes/scatter/gpu/hooks/useVarColumn";
import { useVarSearch } from "@/nodes/scatter/gpu/hooks/useVarSearch";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModalityColorPickerProps {
  colorSource: ColorSource;
  onSetColorSource: (src: ColorSource) => void;

  /** All obs columns (merged across modalities). */
  obsColumns: string[];

  /** Per-modality obs columns: e.g. { rna: ["phase", ...], dinov2: ["object_id", ...] }. */
  modalityObsColumns?: Record<string, string[]>;

  /** Modality names: e.g. ["rna", "dinov2"]. Absent for single-AnnData. */
  modalities?: string[];

  /** Per-modality var counts: e.g. { rna: 18144, dinov2: 768 }. */
  varCount?: number | Record<string, number>;

  /** Active embedding key: used to show cross-modality indicator. */
  activeEmbeddingKey?: string;

  triggerClassName?: string;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ModBadge({ mod, className }: { mod: string; className?: string }) {
  const colors: Record<string, string> = {
    rna: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
    dinov2: "border-violet-500/30 bg-violet-500/15 text-violet-400",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm border px-1 font-mono text-3xs leading-none",
        colors[mod] ?? "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
        className,
      )}
    >
      {mod}
    </span>
  );
}

function CrossModalityIndicator({ embeddingMod, colorMod }: { embeddingMod?: string; colorMod?: string }) {
  if (!embeddingMod || !colorMod || embeddingMod === colorMod) return null;
  return (
    <div className="flex items-center gap-1 border-border border-t px-2 py-1.5">
      <span className="text-3xs text-amber-400">⚡</span>
      <span className="text-3xs text-muted-foreground">
        cross-modality: viewing <ModBadge mod={embeddingMod} /> colored by <ModBadge mod={colorMod} />
      </span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function ModalityColorPicker({
  colorSource,
  onSetColorSource,
  obsColumns,
  modalityObsColumns,
  modalities,
  varCount,
  activeEmbeddingKey,
  triggerClassName,
}: ModalityColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [topTab, setTopTab] = useState<"obs" | "var">("obs");
  const [obsModTab, setObsModTab] = useState("all");
  const [varModTab, setVarModTab] = useState(modalities?.[0] ?? "");
  const [selectedLayer, setSelectedLayer] = useState("X");
  const [varQuery, setVarQuery] = useState("");

  const isMuData = !!modalities && modalities.length > 0;
  const embeddingMod = activeEmbeddingKey ? getModality(activeEmbeddingKey) : undefined;
  const hasVar = typeof varCount === "number" ? varCount > 0 : !!varCount && Object.values(varCount).some((v) => v > 0);

  // ── Internal var hooks ──────────────────────────────────────────────────────
  const { names: varNames, isLoading: varLoading } = useVarSearch(varQuery, isMuData ? varModTab : undefined);
  const layers = useLayerNames();
  const { setStatus } = useScatterUIDispatch();
  const { materialize, status: varStatus, column: varColumn } = useVarColumn({ onStatus: setStatus });

  // When var materialization completes, propagate ColorSource and close
  useEffect(() => {
    if (varStatus === "ready" && varColumn) {
      onSetColorSource(colorSourceFromString(varColumn));
      setOpen(false);
    }
  }, [varStatus, varColumn, onSetColorSource]);

  // Keep selectedLayer valid
  useEffect(() => {
    if (layers.length > 0 && !layers.includes(selectedLayer)) {
      setSelectedLayer(layers[0]);
    }
  }, [layers, selectedLayer]);

  const handleVarSelect = useCallback(
    (varName: string) => {
      materialize(varName, selectedLayer, isMuData ? varModTab : undefined);
    },
    [materialize, selectedLayer, isMuData, varModTab],
  );

  // Derive which obs columns belong to which modality
  const obsGroups = useMemo(() => {
    if (!isMuData || !modalityObsColumns) {
      return { all: obsColumns };
    }

    const modCols = new Set(Object.values(modalityObsColumns).flat());
    const shared = obsColumns.filter((c) => !modCols.has(c) && c !== "_dataset" && c !== "obs_name");

    return {
      all: obsColumns,
      shared,
      ...modalityObsColumns,
    };
  }, [obsColumns, modalityObsColumns, isMuData]);

  // Filter obs columns by active sub-tab
  const visibleObsCols = useMemo(() => {
    if (obsModTab === "all") return obsGroups.all;
    return (obsGroups as Record<string, string[]>)[obsModTab] ?? [];
  }, [obsModTab, obsGroups]);

  // Derive color modality for cross-mod indicator
  const colorMod = useMemo<string | undefined>(() => {
    if (colorSource.kind === "var" && isMuData) {
      return varModTab;
    }
    if (colorSource.kind === "obs" && isMuData && modalityObsColumns) {
      for (const [mod, cols] of Object.entries(modalityObsColumns)) {
        if (cols.includes(colorSource.column)) return mod;
      }
    }
    return;
  }, [colorSource, isMuData, varModTab, modalityObsColumns]);

  // ── Trigger ─────────────────────────────────────────────────────────────────
  let triggerLabel: React.ReactNode;
  switch (colorSource.kind) {
    case "none":
      triggerLabel = <span className="text-muted-foreground">none</span>;
      break;
    case "obs":
      triggerLabel = (
        <>
          <span className="min-w-0 flex-1 truncate text-left" title={colorSource.column}>
            {colorSource.column}
          </span>
          <Badge variant="outline" className="shrink-0 px-1 py-0 text-3xs">
            obs
          </Badge>
          {colorMod && <ModBadge mod={colorMod} className="shrink-0" />}
        </>
      );
      break;
    case "var":
      triggerLabel = (
        <>
          <span className="min-w-0 flex-1 truncate text-left font-mono" title={colorSource.varName}>
            {colorSource.varName}
          </span>
          <Badge variant="outline" className="shrink-0 border-emerald-500/30 px-1 py-0 text-3xs text-emerald-400">
            {colorSource.layer}
          </Badge>
          {colorMod && <ModBadge mod={colorMod} className="shrink-0" />}
        </>
      );
      break;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex h-7 min-w-0 items-center justify-between gap-1.5 whitespace-nowrap rounded-md border border-input bg-input/20 px-2 text-xs/relaxed",
          "hover:bg-input/40 focus-visible:ring-2 focus-visible:ring-ring/30",
          triggerClassName,
        )}
      >
        {triggerLabel}
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent className="w-72 p-0" side="bottom" align="start" sideOffset={4}>
        <Tabs value={topTab} onValueChange={(v) => setTopTab(v as "obs" | "var")}>
          {/* Top-level tabs: Obs / Var */}
          <TabsList className="w-full justify-start rounded-none border-border border-b bg-transparent p-1">
            <TabsTrigger value="obs" className="text-xs">
              Obs
            </TabsTrigger>
            {hasVar && (
              <TabsTrigger value="var" className="text-xs">
                Var
              </TabsTrigger>
            )}
          </TabsList>

          {/* ── Obs tab ── */}
          <TabsContent value="obs" className="mt-0">
            {/* Modality sub-tabs (only for MuData) */}
            {isMuData && (
              <div className="flex gap-1 border-border border-b px-2 py-1">
                {["all", "shared", ...modalities].map((mod) => (
                  <button
                    key={mod}
                    type="button"
                    onClick={() => setObsModTab(mod)}
                    className={cn(
                      "rounded-sm px-1.5 py-0.5 text-3xs transition-colors",
                      obsModTab === mod
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    {mod}
                  </button>
                ))}
              </div>
            )}

            <Command>
              <CommandInput placeholder="Search columns…" className="text-xs" />
              <CommandList>
                <ScrollArea className="max-h-48">
                  <CommandEmpty>No columns found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="__none__"
                      onSelect={() => {
                        onSetColorSource(COLOR_NONE);
                        setOpen(false);
                      }}
                    >
                      <span className="text-muted-foreground">none: single color</span>
                    </CommandItem>
                  </CommandGroup>
                  {/* When "all" + MuData: group by modality with headings */}
                  {obsModTab === "all" && isMuData && modalityObsColumns ? (
                    <>
                      {/* Shared columns (not in any modality) */}
                      {(() => {
                        const modCols = new Set(Object.values(modalityObsColumns).flat());
                        const shared = obsColumns.filter(
                          (c) => !modCols.has(c) && c !== "_dataset" && c !== "obs_name",
                        );
                        return shared.length > 0 ? (
                          <CommandGroup heading="shared">
                            {shared.map((col) => (
                              <CommandItem
                                key={col}
                                value={col}
                                onSelect={() => {
                                  onSetColorSource(colorSourceObs(col));
                                  setOpen(false);
                                }}
                              >
                                <span className="flex-1 truncate">{col}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        ) : null;
                      })()}
                      {/* Per-modality groups */}
                      {Object.entries(modalityObsColumns).map(([mod, cols]) => (
                        <CommandGroup key={mod} heading={mod}>
                          {cols.map((col) => (
                            <CommandItem
                              key={`${mod}:${col}`}
                              value={col}
                              onSelect={() => {
                                onSetColorSource(colorSourceObs(col));
                                setOpen(false);
                              }}
                            >
                              <span className="flex-1 truncate">{col}</span>
                              <ModBadge mod={mod} />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </>
                  ) : (
                    /* Filtered view or non-MuData: flat list */
                    <CommandGroup>
                      {visibleObsCols
                        .filter((c) => c !== "_dataset" && c !== "obs_name")
                        .map((col) => {
                          let origin: string | undefined;
                          if (isMuData && modalityObsColumns) {
                            for (const [mod, cols] of Object.entries(modalityObsColumns)) {
                              if (cols.includes(col)) {
                                origin = mod;
                                break;
                              }
                            }
                          }
                          return (
                            <CommandItem
                              key={col}
                              value={col}
                              onSelect={() => {
                                onSetColorSource(colorSourceObs(col));
                                setOpen(false);
                              }}
                            >
                              <span className="flex-1 truncate">{col}</span>
                              {origin && <ModBadge mod={origin} />}
                            </CommandItem>
                          );
                        })}
                    </CommandGroup>
                  )}
                </ScrollArea>
              </CommandList>
            </Command>
          </TabsContent>

          {/* ── Var tab ── */}
          <TabsContent value="var" className="mt-0">
            {/* Modality picker (only for MuData) */}
            {isMuData && modalities && (
              <div className="flex gap-1 border-border border-b px-2 py-1.5">
                {modalities.map((mod) => {
                  const count = typeof varCount === "object" ? varCount[mod] : undefined;
                  return (
                    <button
                      key={mod}
                      type="button"
                      onClick={() => {
                        setVarModTab(mod);
                        setVarQuery("");
                      }}
                      className={cn(
                        "flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-3xs transition-colors",
                        varModTab === mod
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <ModBadge mod={mod} />
                      {count != null && <span className="text-muted-foreground">{count.toLocaleString()}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            <Command shouldFilter={false}>
              <CommandInput
                value={varQuery}
                onValueChange={setVarQuery}
                placeholder={isMuData ? `Search ${varModTab} vars…` : "Search vars…"}
                className="text-xs"
              />
              <CommandList>
                <ScrollArea className="max-h-48">
                  {varLoading && <div className="py-4 text-center text-muted-foreground text-xs">Loading…</div>}
                  {!varLoading && varNames.length === 0 && varQuery && <CommandEmpty>No vars found.</CommandEmpty>}
                  {!varLoading && varNames.length > 0 && (
                    <CommandGroup>
                      {varNames.map((name) => (
                        <CommandItem
                          key={name}
                          value={name}
                          disabled={varStatus === "loading"}
                          onSelect={() => handleVarSelect(name)}
                        >
                          <span className="font-mono text-xs">{name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </ScrollArea>
              </CommandList>
            </Command>

            {/* Layer chips */}
            <div className="flex items-center gap-1 border-border border-t px-2 py-1.5">
              <span className="text-3xs text-muted-foreground">Layer:</span>
              {layers.map((layer) => (
                <button
                  key={layer}
                  type="button"
                  onClick={() => {
                    setSelectedLayer(layer);
                    if (isVarSource(colorSource) && layer !== colorSource.layer) {
                      materialize(colorSource.varName, layer, isMuData ? varModTab : undefined);
                    }
                  }}
                  className={cn(
                    "rounded-sm border px-1.5 py-0.5 font-mono text-3xs transition-colors",
                    selectedLayer === layer
                      ? "border-primary/50 bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {layer}
                </button>
              ))}
            </div>

            {varStatus === "loading" && (
              <div className="border-border border-t px-2 py-1.5">
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Cross-modality indicator */}
        <CrossModalityIndicator embeddingMod={embeddingMod} colorMod={colorMod} />
      </PopoverContent>
    </Popover>
  );
}
