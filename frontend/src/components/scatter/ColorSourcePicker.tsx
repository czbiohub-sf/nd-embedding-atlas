import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useScatterUIDispatch } from "@/components/scatter/ScatterUIStateProvider";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    COLOR_NONE,
    type ColorSource,
    colorSourceFromString,
    colorSourceObs,
    colorSourceVar,
    isVarSource,
} from "@/lib/color-source";
import { cn } from "@/lib/utils";
import { useVarColumn } from "@/scatter-gpu/hooks/useVarColumn";
import { useGeneSearch } from "@/scatter-gpu/hooks/useGeneSearch";
import { useLayerNames } from "@/scatter-gpu/hooks/useLayerNames";

// ── Trigger label helpers ─────────────────────────────────────────────────────

function ObsBadge() {
    return (
        <span className="shrink-0 rounded-sm border border-blue-500/30 bg-blue-500/20 px-1 font-sans text-[9px] text-blue-400 leading-none">
            obs
        </span>
    );
}

function VarBadge({ layer }: { layer: string }) {
    return (
        <span className="shrink-0 rounded-sm border border-emerald-500/30 bg-emerald-500/20 px-1 font-sans text-[9px] text-emerald-400 leading-none">
            {layer}
        </span>
    );
}

// ── Tab button ────────────────────────────────────────────────────────────────

function TabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "flex-1 rounded-sm px-2 py-0.5 font-medium text-xs transition-colors",
                active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
        >
            {children}
        </button>
    );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ColorSourcePickerProps {
    colorSource: ColorSource;
    obsColumns: string[];
    /** Whether the dataset has a var/expression matrix. Hides the Var tab when false. */
    hasVar?: boolean;
    onSetColorSource: (src: ColorSource) => void;
    /** Glass-override for the trigger button className */
    triggerClassName?: string;
    contentClassName?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ColorSourcePicker({
    colorSource,
    obsColumns,
    hasVar = false,
    onSetColorSource,
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
    const {
        materialize,
        status: varStatus,
        column: varColumn,
    } = useVarColumn({ onStatus: setStatus });

    // When var materialization completes, propagate the ColorSource and close.
    useEffect(() => {
        if (varStatus === "ready" && varColumn) {
            onSetColorSource(colorSourceFromString(varColumn));
            setOpen(false);
        }
    }, [varStatus, varColumn, onSetColorSource]);

    // Ensure selectedLayer stays valid when layers load.
    useEffect(() => {
        if (layers.length > 0 && !layers.includes(selectedLayer)) {
            setSelectedLayer(layers[0]);
        }
    }, [layers, selectedLayer]);

    // ── Trigger display ──────────────────────────────────────────────────────────
    let triggerContent: React.ReactNode;
    switch (colorSource.kind) {
        case "none":
            triggerContent = (
                <span className="flex-1 truncate text-left text-muted-foreground">— none</span>
            );
            break;
        case "obs":
            triggerContent = (
                <>
                    <span className="flex-1 truncate text-left">{colorSource.column}</span>
                    <ObsBadge />
                </>
            );
            break;
        case "var":
            triggerContent = (
                <>
                    <span className="flex-1 truncate text-left font-mono">
                        {colorSource.varName}
                    </span>
                    <VarBadge layer={colorSource.layer} />
                </>
            );
            break;
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
                    "flex h-7 min-w-0 items-center justify-between gap-1.5 whitespace-nowrap rounded-md border border-input bg-input/20 px-2 text-xs/relaxed outline-none transition-colors",
                    "hover:bg-input/40 focus-visible:ring-2 focus-visible:ring-ring/30",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    "dark:bg-input/30",
                    triggerClassName,
                )}
            >
                {triggerContent}
                <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </PopoverTrigger>

            <PopoverContent
                className={cn("w-64 gap-0 p-0", contentClassName)}
                side="bottom"
                align="start"
                sideOffset={4}
            >
                {/* Tab switcher — Var tab only shown when dataset has expression data */}
                <div className="flex gap-1 border-border border-b p-1">
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
                                        onSetColorSource(COLOR_NONE);
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
                                            onSetColorSource(colorSourceObs(col));
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
                            <CommandInput
                                value={varQuery}
                                onValueChange={setVarQuery}
                                placeholder="Search var…"
                            />
                            <CommandList>
                                {varsLoading && (
                                    <div className="py-4 text-center text-muted-foreground text-xs">
                                        Loading…
                                    </div>
                                )}
                                {!varsLoading && names.length === 0 && (
                                    <CommandEmpty>No var found.</CommandEmpty>
                                )}
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
                        <div className="flex flex-wrap gap-1 border-border border-t p-2">
                            {layers.map((layer) => (
                                <button
                                    key={layer}
                                    type="button"
                                    onClick={() => {
                                        setSelectedLayer(layer);
                                        if (
                                            isVarSource(colorSource) &&
                                            layer !== colorSource.layer
                                        ) {
                                            materialize(colorSource.varName, layer);
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
                            <div className="border-border border-t px-3 py-2 text-destructive text-xs">
                                Failed to load var.
                            </div>
                        )}
                    </>
                )}
            </PopoverContent>
        </Popover>
    );
}

// Re-export ColorSource so callers can import from this module if convenient
export type { ColorSource };
// eslint-disable-next-line react/only-export-components
export { colorSourceVar };
