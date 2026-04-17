import { cn } from "@/lib/utils";
import { getColormapList } from "../../lib/ochre-palette";
import { useColormapPalette } from "../../hooks/useColormaps";

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
        active ? "border-white/30 bg-white/[0.06]" : "border-transparent hover:bg-white/[0.04]",
      )}
    >
      {/* gradient is computed — inline style is required */}
      <div className="h-2 rounded-sm" style={{ background: gradient }} />
      <span className="text-center text-[9px] text-muted-foreground leading-none">{name}</span>
    </button>
  );
}

interface ColormapGridProps {
  active: string;
  onSelect: (name: string) => void;
}

export function ColormapGrid({ active, onSelect }: ColormapGridProps) {
  const { continuous } = getColormapList();
  return (
    <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto pr-1">
      {continuous.map((name) => (
        <ColormapSwatch key={name} name={name} active={active === name} onSelect={onSelect} />
      ))}
    </div>
  );
}
