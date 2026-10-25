import { Slider } from "@ndea/ui/components/slider";
import { useScatterServices } from "./context";

interface Props {
  title: string;
  colormap: string;
  reversed: boolean;
  vmin: number;
  vmax: number;
  /** Full data range: the slider bounds. */
  absoluteVmin: number;
  absoluteVmax: number;
  /** Called on every move with the current range (real-time). */
  onRangeChange(vmin: number, vmax: number): void;
  /** Back to the full range (no range filter). */
  onResetRange(): void;
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 10000 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(2);
  return v.toPrecision(3);
}

/**
 * Continuous legend body (design data/Legend.jsx): the colormap bar, a
 * two-thumb range slider that filters to [vmin, vmax], and the range's ends.
 * Colormap, reverse and scale live in the Legend popover.
 */
export function ContinuousLegend({
  title,
  colormap,
  reversed,
  vmin,
  vmax,
  absoluteVmin,
  absoluteVmax,
  onRangeChange,
  onResetRange,
}: Props) {
  const colors = useScatterServices().getCategoricalPalette(colormap, 16);
  const span = absoluteVmax - absoluteVmin;
  const narrowed = vmin > absoluteVmin || vmax < absoluteVmax;

  return (
    <div className="flex min-w-40 flex-col gap-px">
      <div className="flex items-center gap-1.5 px-1.5 pt-[3px] pb-1">
        <span className="flex-1 truncate font-mono text-sm text-text-muted">{title}</span>
        {narrowed ? (
          <button type="button" className="text-sm text-primary" onClick={onResetRange}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="px-1.5 pt-0.5 pb-1.5">
        <div
          className="h-2 rounded-full"
          style={{ background: `linear-gradient(to ${reversed ? "left" : "right"}, ${colors.join(", ")})` }}
        />
        {span > 0 ? (
          <Slider
            className="mt-1"
            min={absoluteVmin}
            max={absoluteVmax}
            step={span / 1000}
            value={[vmin, vmax]}
            onValueChange={(v) => {
              if (Array.isArray(v) && v.length === 2) onRangeChange(v[0], v[1]);
            }}
          />
        ) : null}
        <div className="mt-1 flex justify-between font-mono text-xs text-text-muted tabular-nums">
          <span>{formatValue(vmin)}</span>
          <span>{formatValue(vmax)}</span>
        </div>
      </div>
    </div>
  );
}
