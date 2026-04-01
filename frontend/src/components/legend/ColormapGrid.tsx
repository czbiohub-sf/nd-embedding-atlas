import { cn } from "@/lib/utils";
import { useColormapPalette } from "../../hooks/useColormaps";

export const CONTINUOUS_COLORMAPS = [
  "viridis",
  "plasma",
  "magma",
  "inferno",
  "coolwarm",
  "RdBu",
  "greys",
  "cividis",
] as const;

export type ContinuousColormapName = (typeof CONTINUOUS_COLORMAPS)[number];

interface ColormapSwatchProps {
  name: string;
  active: boolean;
  onSelect: (name: string) => void;
}

function ColormapSwatch({ name, active, onSelect }: ColormapSwatchProps) {
  const { data: stops } = useColormapPalette(name, 8);
  const gradient = stops
    ? `linear-gradient(to right, ${stops.join(",")})`
    : "linear-gradient(to right, #888, #444)";

  return (
    <button
      type="button"
      onClick={() => onSelect(name)}
      className={cn(
        "flex flex-col gap-1 p-1 rounded-md border transition-colors",
        active ? "border-white/30 bg-white/[0.06]" : "border-transparent hover:bg-white/[0.04]",
      )}
    >
      {/* gradient is computed — inline style is required */}
      <div className="h-2 rounded-sm" style={{ background: gradient }} />
      <span className="text-[9px] text-center text-muted-foreground leading-none">{name}</span>
    </button>
  );
}

interface ColormapGridProps {
  active: string;
  onSelect: (name: string) => void;
}

export function ColormapGrid({ active, onSelect }: ColormapGridProps) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {CONTINUOUS_COLORMAPS.map((name) => (
        <ColormapSwatch key={name} name={name} active={active === name} onSelect={onSelect} />
      ))}
    </div>
  );
}
