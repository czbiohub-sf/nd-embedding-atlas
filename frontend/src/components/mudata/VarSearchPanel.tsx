import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VarSearchPanelProps {
  modalities?: string[];
  activeModality?: string;
  onSelectVar: (varName: string, layer: string, modality?: string) => void;
}

// ── Layer selector ───────────────────────────────────────────────────────────

const LAYERS = ["X", "raw", "scaled"];

function LayerChips({ selected, onSelect }: { selected: string; onSelect: (layer: string) => void }) {
  return (
    <div className="flex items-center gap-1 border-border border-t px-2 py-1.5">
      <span className="mr-1 text-text-muted text-[10px]">Layer</span>
      {LAYERS.map((layer) => (
        <button
          key={layer}
          type="button"
          onClick={() => onSelect(layer)}
          className={cn(
            "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
            selected === layer
              ? "border-primary/50 bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {layer}
        </button>
      ))}
    </div>
  );
}

// ── Mock search (simulates /api/var/names?q=...) ─────────────────────────────

const MOCK_VAR_NAMES = [
  "GAPDH",
  "ACTB",
  "TP53",
  "BRCA1",
  "EGFR",
  "MYC",
  "KRAS",
  "PTEN",
  "CDH1",
  "RB1",
  "APC",
  "VHL",
  "MLH1",
  "SMAD4",
  "CDKN2A",
];

function useMockVarSearch(query: string) {
  const q = query.toLowerCase();
  const names = q.length > 0 ? MOCK_VAR_NAMES.filter((n) => n.toLowerCase().includes(q)) : MOCK_VAR_NAMES.slice(0, 8);
  return { names, isLoading: false };
}

// ── Component ────────────────────────────────────────────────────────────────

export function VarSearchPanel({ modalities, activeModality, onSelectVar }: VarSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [selectedLayer, setSelectedLayer] = useState("X");
  const [currentModality, setCurrentModality] = useState(activeModality ?? modalities?.[0]);
  const { names, isLoading } = useMockVarSearch(query);

  const hasModalities = modalities != null && modalities.length > 0;

  const searchPanel = (modality?: string) => (
    <>
      <Command shouldFilter={false}>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search var names..." />
        <CommandList>
          {isLoading && <div className="py-4 text-center text-muted-foreground text-xs">Loading...</div>}
          {!isLoading && names.length === 0 && <CommandEmpty>No var found.</CommandEmpty>}
          {!isLoading && names.length > 0 && (
            <CommandGroup>
              {names.map((varName) => (
                <CommandItem
                  key={varName}
                  value={varName}
                  onSelect={() => onSelectVar(varName, selectedLayer, modality)}
                >
                  <span className="flex-1 font-mono">{varName}</span>
                  <Badge variant="outline" className="text-[9px]">
                    {selectedLayer}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
      <LayerChips selected={selectedLayer} onSelect={setSelectedLayer} />
    </>
  );

  if (!hasModalities) {
    return (
      <div className="w-72 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-md">
        {searchPanel()}
      </div>
    );
  }

  return (
    <div className="w-80 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-md">
      <Tabs defaultValue={currentModality} onValueChange={(v: string | number) => setCurrentModality(String(v))}>
        <TabsList variant="line" className="w-full justify-start border-border border-b px-1">
          {modalities.map((mod) => (
            <TabsTrigger key={mod} value={mod}>
              {mod}
            </TabsTrigger>
          ))}
        </TabsList>

        {modalities.map((mod) => (
          <TabsContent key={mod} value={mod}>
            {searchPanel(mod)}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
