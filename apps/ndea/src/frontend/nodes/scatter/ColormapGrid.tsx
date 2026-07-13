import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useColormapPalette } from "@/hooks/useColormaps";
import { getColormapList } from "@/lib/color/ochre-palette";

interface ColormapSwatchProps {
  name: string;
  active: boolean;
  onSelect: (name: string) => void;
}

function ColormapSwatch({ name, active, onSelect }: ColormapSwatchProps) {
  const { data: stops } = useColormapPalette(name, 8);
  const gradient = stops ? `linear-gradient(to right, ${stops.join(",")})` : "linear-gradient(to right, #888, #444)";

  return (
    <button
      type="button"
      onClick={() => onSelect(name)}
      className={cn(
        "flex flex-col gap-1 rounded-md border p-1 transition-colors",
        active ? "border-border-active bg-accent" : "border-transparent hover:bg-muted",
      )}
    >
      {/* gradient is computed — inline style is required */}
      <div className="h-2 rounded-sm" style={{ background: gradient }} />
      <span className="truncate text-center text-3xs text-muted-foreground leading-none">{name}</span>
    </button>
  );
}

interface ColormapGridProps {
  active: string;
  onSelect: (name: string) => void;
}

export function ColormapGrid({ active, onSelect }: ColormapGridProps) {
  const { continuous } = getColormapList();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return continuous;
    return continuous.filter((name) => name.toLowerCase().includes(q));
  }, [continuous, query]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 px-0.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search colormaps…"
          className="h-6 w-full rounded-sm border border-border bg-background/40 px-2 font-mono text-3xs text-foreground placeholder:text-muted-foreground/50 focus:border-border-active focus:outline-none"
          autoFocus={false}
        />
        <span className="shrink-0 font-mono text-3xs text-muted-foreground/70 tabular-nums">
          {filtered.length}/{continuous.length}
        </span>
      </div>
      <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto pr-1">
        {filtered.map((name) => (
          <ColormapSwatch key={name} name={name} active={active === name} onSelect={onSelect} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-2 py-2 text-center font-mono text-3xs text-muted-foreground/60">
            No colormaps match “{query}”
          </div>
        )}
      </div>
    </div>
  );
}
