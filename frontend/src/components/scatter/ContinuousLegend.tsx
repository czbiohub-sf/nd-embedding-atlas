import { useEffect, useState } from "react";

interface Props {
  columnName: string;
  colormap: string;
  vmin: number;
  vmax: number;
}

/**
 * Compact gradient legend for continuous (numeric) column coloring.
 * Positioned top-right like CategoricalLegend, shown in its place when
 * color mode is "continuous".
 *
 * Fetches colormap preview via /data/categorical-palette (which supports
 * any cmap-recognized colormap name, including viridis, plasma, etc.).
 * Falls back to hardcoded CSS gradient stops for known colormaps if the
 * fetch fails.
 */

const COLORMAP_FALLBACKS: Record<string, string> = {
  viridis: "#440154, #414487, #2a788e, #22a884, #7ad151, #fde725",
  plasma: "#0d0887, #7e03a8, #cb4678, #f89441, #f0f921",
  magma: "#000004, #3b0f70, #8c2981, #de4968, #fe9f6d, #fcfdbf",
  inferno: "#000004, #420a68, #932667, #dd513a, #fca50a, #fcffa4",
  coolwarm: "#3b4cc0, #6788ee, #9bbcff, #f7f7f7, #ffaa8d, #e26952, #b40426",
};

export function ContinuousLegend({ columnName, colormap, vmin, vmax }: Props) {
  const [gradientStops, setGradientStops] = useState<string>("");

  useEffect(() => {
    fetch(`/data/categorical-palette?colormap=${encodeURIComponent(colormap)}&n=16`)
      .then((r) => r.json())
      .then((data: { colors: string[] }) => {
        setGradientStops(data.colors.join(", "));
      })
      .catch(() => {
        const fallback = COLORMAP_FALLBACKS[colormap] ?? COLORMAP_FALLBACKS["viridis"];
        setGradientStops(fallback);
      });
  }, [colormap]);

  function formatValue(v: number): string {
    if (Math.abs(v) >= 10000 || (Math.abs(v) < 0.01 && v !== 0)) {
      return v.toExponential(2);
    }
    return v.toPrecision(3);
  }

  return (
    <div className="legend-continuous">
      <div className="legend-continuous-title" title={columnName}>
        {columnName}
      </div>
      <div
        className="legend-continuous-bar"
        style={{
          background: gradientStops
            ? `linear-gradient(to right, ${gradientStops})`
            : "var(--color-surface)",
        }}
      />
      <div className="legend-continuous-ticks">
        <span>{formatValue(vmin)}</span>
        <span>{formatValue(vmax)}</span>
      </div>
    </div>
  );
}
