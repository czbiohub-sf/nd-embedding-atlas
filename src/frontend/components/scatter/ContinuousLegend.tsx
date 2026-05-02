import { useId } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Panel } from "@/components/ui/panel";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useColormapPalette } from "../../hooks/useColormaps";
import { ColormapGrid } from "./ColormapGrid";

interface Props {
  columnName: string;
  colormap: string;
  vmin: number;
  vmax: number;
  /** Full data range — defines slider bounds. Defaults to [vmin, vmax] if not provided. */
  absoluteVmin?: number;
  absoluteVmax?: number;
  /** Whether the colormap gradient is reversed (display-only until backend ships). */
  reversed?: boolean;
  /** Current scale mode — wired to UI but not in query key until backend ships. */
  scale?: "linear" | "log" | "sqrt";
  /** Called on every move with the current range (real-time). */
  onRangeChange?: (vmin: number, vmax: number) => void;
  /** Called when the user selects a new colormap from the grid. */
  onColormapChange?: (name: string) => void;
  /** Called when the user toggles the reversed flag. */
  onReversedChange?: (reversed: boolean) => void;
  /** Called when the user selects a scale mode. */
  onScaleChange?: (scale: "linear" | "log" | "sqrt") => void;
  /** Called when the user clicks "Reset range" — should restore absolute min/max. */
  onResetRange?: () => void;
}

const COLORMAP_FALLBACKS: Record<string, string[]> = {
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  plasma: ["#0d0887", "#7e03a8", "#cb4678", "#f89441", "#f0f921"],
  magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
  inferno: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  coolwarm: ["#3b4cc0", "#6788ee", "#9bbcff", "#f7f7f7", "#ffaa8d", "#e26952", "#b40426"],
};

/**
 * Small circular swatch filled with the colormap gradient. Doubles as the
 * right-click target for colormap / reverse / scale / reset options.
 * Built as an inline SVG so the gradient definition stays self-contained.
 */
function ColormapCircle({ colormap, reversed, size = 14 }: { colormap: string; reversed: boolean; size?: number }) {
  const paletteQuery = useColormapPalette(colormap, 16);
  const colors = paletteQuery.data ?? COLORMAP_FALLBACKS[colormap] ?? COLORMAP_FALLBACKS.viridis;
  const gradientId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
      <defs>
        <linearGradient id={gradientId} x1={reversed ? "100%" : "0%"} y1="0%" x2={reversed ? "0%" : "100%"} y2="0%">
          {colors.map((color, i) => (
            <stop
              key={`${i}-${color}`}
              offset={`${colors.length > 1 ? (i / (colors.length - 1)) * 100 : 0}%`}
              stopColor={color}
            />
          ))}
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill={`url(#${gradientId})`} stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 10000 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(2);
  return v.toPrecision(3);
}

interface ActionButtonProps {
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

function ActionButton({ active, disabled, onClick, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex-1 rounded border px-1.5 py-0.5 font-mono text-[9px] transition-colors",
        active
          ? "border-white/20 bg-white/10 text-white"
          : "border-transparent text-muted-foreground hover:bg-white/[0.06] hover:text-white",
        "disabled:pointer-events-none disabled:opacity-30",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Dual native <input type="range"> overlaid in the same track. Track is
 * pointer-events:none on the input element; only the ::-webkit-slider-thumb
 * (and its Firefox sibling) pick up clicks. This lets each thumb be
 * independently draggable while sharing the same space, and piggybacks on
 * the browser's native drag handling — same primitive as PointSizeSlider.
 */
export function ContinuousLegend({
  columnName,
  colormap,
  vmin,
  vmax,
  absoluteVmin,
  absoluteVmax,
  reversed = false,
  scale,
  onRangeChange,
  onColormapChange,
  onReversedChange,
  onScaleChange,
  onResetRange,
}: Props) {
  const absMin = absoluteVmin ?? vmin;
  const absMax = absoluteVmax ?? vmax;
  const hasRange = absMax > absMin && onRangeChange != null;
  const span = absMax - absMin;
  const step = span > 0 ? span / 1000 : 0.001;

  void scale;

  return (
    <Panel variant="glass" className="absolute top-10 left-2 z-20 w-52 px-2.5 py-2" title={columnName}>
      {/* Single row: [colormap circle] [range slider] */}
      <div className="flex items-center gap-2">
        <ContextMenu>
          <ContextMenuTrigger
            aria-label="Colormap options"
            className="inline-flex shrink-0 cursor-context-menu items-center text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none"
          >
            <ColormapCircle colormap={colormap} reversed={reversed} />
          </ContextMenuTrigger>

          <ContextMenuContent className="w-60 rounded-lg border border-white/[0.07] bg-card/80 p-2 font-mono shadow-black/20 shadow-lg backdrop-blur-md">
            <ColormapGrid active={colormap} onSelect={onColormapChange ?? (() => {})} />

            <ContextMenuSeparator />

            <div className="flex gap-1 px-1 py-0.5">
              <ActionButton active={reversed} onClick={() => onReversedChange?.(!reversed)}>
                ⇄ Reverse
              </ActionButton>
              <ActionButton disabled={onResetRange == null} onClick={onResetRange}>
                ↺ Reset range
              </ActionButton>
            </div>

            {onScaleChange && (
              <div className="flex gap-1 px-1 py-0.5">
                {(["linear", "log", "sqrt"] as const).map((s) => (
                  <ActionButton key={s} active={scale === s} onClick={() => onScaleChange(s)}>
                    {s === "sqrt" ? "√" : s}
                  </ActionButton>
                ))}
              </div>
            )}
          </ContextMenuContent>
        </ContextMenu>

        {/* shadcn Slider — same component as ChannelControls contrast slider,
            no wrapping elements that could swallow pointer events. */}
        {hasRange && (
          <Slider
            className="flex-1"
            min={absMin}
            max={absMax}
            step={step}
            value={[vmin, vmax]}
            onValueChange={(v) => {
              if (Array.isArray(v) && v.length === 2) onRangeChange?.(v[0], v[1]);
            }}
          />
        )}
      </div>

      {/* Min / max labels */}
      <div className="mt-1 flex justify-between px-0.5 font-mono text-[9px] text-muted-foreground/70 tabular-nums">
        <span>{formatValue(vmin)}</span>
        <span>{formatValue(vmax)}</span>
      </div>
    </Panel>
  );
}
