/**
 * Named categorical palette picker — parallel to ColormapGrid (continuous).
 * Each swatch shows the first N colors of the palette as a sample strip.
 */
import { cn } from "@/lib/utils";
import { useColormapPalette } from "../../hooks/useColormaps";
import { getColormapList } from "../../lib/ochre-palette";

interface PaletteSwatchProps {
  name: string;
  active: boolean;
  onSelect: (name: string) => void;
}

// How many colors to display in the preview strip. Matches the way
// ContinuousLegend samples: wide enough to see the palette character,
// small enough to fit in a tight menu.
const PREVIEW_COUNT = 10;

function PaletteSwatch({ name, active, onSelect }: PaletteSwatchProps) {
  const { data: colors } = useColormapPalette(name, PREVIEW_COUNT);
  const chips = colors ?? Array.from({ length: PREVIEW_COUNT }, () => "#666");

  return (
    <button
      type="button"
      onClick={() => onSelect(name)}
      className={cn(
        "flex flex-col gap-1 rounded-md border p-1 transition-colors",
        active ? "border-border-active bg-accent" : "border-transparent hover:bg-muted",
      )}
    >
      <div className="flex h-2.5 overflow-hidden rounded-sm">
        {chips.map((c, i) => (
          <div key={`${i}-${c}`} className="flex-1" style={{ background: c }} />
        ))}
      </div>
      <span className="truncate text-center text-3xs text-muted-foreground leading-none">{name}</span>
    </button>
  );
}

interface CategoricalPaletteGridProps {
  active: string;
  onSelect: (name: string) => void;
}

export function CategoricalPaletteGrid({ active, onSelect }: CategoricalPaletteGridProps) {
  const { categorical } = getColormapList();
  return (
    <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto pr-1">
      {categorical.map((name) => (
        <PaletteSwatch key={name} name={name} active={active === name} onSelect={onSelect} />
      ))}
    </div>
  );
}
