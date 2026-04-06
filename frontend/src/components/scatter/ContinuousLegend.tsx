import { useCallback, useEffect, useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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

const COLORMAP_FALLBACKS: Record<string, string> = {
  viridis: "#440154, #414487, #2a788e, #22a884, #7ad151, #fde725",
  plasma: "#0d0887, #7e03a8, #cb4678, #f89441, #f0f921",
  magma: "#000004, #3b0f70, #8c2981, #de4968, #fe9f6d, #fcfdbf",
  inferno: "#000004, #420a68, #932667, #dd513a, #fca50a, #fcffa4",
  coolwarm: "#3b4cc0, #6788ee, #9bbcff, #f7f7f7, #ffaa8d, #e26952, #b40426",
};

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
  const paletteQuery = useColormapPalette(colormap, 16);
  const gradientStops = paletteQuery.data
    ? paletteQuery.data.join(", ")
    : (COLORMAP_FALLBACKS[colormap] ?? COLORMAP_FALLBACKS.viridis);

  const absMin = absoluteVmin ?? vmin;
  const absMax = absoluteVmax ?? vmax;
  const hasRange = absMax > absMin && onRangeChange != null;

  const toFrac = useCallback((v: number) => (absMax > absMin ? (v - absMin) / (absMax - absMin) : 0), [absMin, absMax]);
  const toVal = useCallback((f: number) => absMin + f * (absMax - absMin), [absMin, absMax]);

  const [localMin, setLocalMin] = useState(() => toFrac(vmin));
  const [localMax, setLocalMax] = useState(() => toFrac(vmax));

  const localMinRef = useRef(localMin);
  const localMaxRef = useRef(localMax);
  const onRangeChangeRef = useRef(onRangeChange);
  const toValRef = useRef(toVal);
  localMinRef.current = localMin;
  localMaxRef.current = localMax;
  onRangeChangeRef.current = onRangeChange;
  toValRef.current = toVal;

  const draggingRef = useRef<"min" | "max" | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!draggingRef.current) {
      setLocalMin(toFrac(vmin));
      setLocalMax(toFrac(vmax));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmin, vmax, toFrac]);

  const fracFromClientX = useCallback((clientX: number): number => {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const startDrag = useCallback(
    (which: "min" | "max") => {
      draggingRef.current = which;

      function onMove(e: PointerEvent) {
        const f = fracFromClientX(e.clientX);
        if (which === "min") {
          const next = Math.min(f, localMaxRef.current - 0.01);
          setLocalMin(next);
          localMinRef.current = next;
        } else {
          const next = Math.max(f, localMinRef.current + 0.01);
          setLocalMax(next);
          localMaxRef.current = next;
        }
        onRangeChangeRef.current?.(toValRef.current(localMinRef.current), toValRef.current(localMaxRef.current));
      }

      function onUp() {
        draggingRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [fracFromClientX],
  );

  const minPct = `${(localMin * 100).toFixed(1)}%`;
  const maxPct = `${(localMax * 100).toFixed(1)}%`;
  const scaleBadge = scale && scale !== "linear" ? (scale === "sqrt" ? "√" : scale) : null;

  return (
    <div className="absolute top-10 left-2 z-20 w-44 rounded-lg border border-white/[0.07] bg-card/80 p-2.5 backdrop-blur-md">
      {/* Column name + optional scale badge */}
      <p className="mb-1.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
        <span className="flex-1 truncate" title={columnName}>
          {columnName}
        </span>
        {scaleBadge && <span className="shrink-0 text-[9px] text-accent-cyan">{scaleBadge}</span>}
      </p>

      {/* Gradient bar — right-click opens colormap/scale context menu */}
      <ContextMenu>
        <ContextMenuTrigger>
          <div ref={barRef} className="relative h-3 w-full cursor-context-menu select-none rounded-sm">
            {/* Full gradient — scaleX(-1) for reversed display */}
            <div
              className="absolute inset-0 rounded-sm"
              style={{
                background: `linear-gradient(to right, ${gradientStops})`,
                transform: reversed ? "scaleX(-1)" : undefined,
              }}
            />

            {hasRange && (
              <>
                <div className="absolute inset-y-0 left-0 rounded-l-sm bg-black/50" style={{ width: minPct }} />
                <div
                  className="absolute inset-y-0 right-0 rounded-r-sm bg-black/50"
                  style={{ width: `${((1 - localMax) * 100).toFixed(1)}%` }}
                />

                <button
                  type="button"
                  aria-label="Set minimum value"
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm border-2 border-white/90 bg-white/20 shadow hover:bg-white/40 focus-visible:outline-none"
                  style={{ left: minPct, touchAction: "none" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    startDrag("min");
                  }}
                />

                <button
                  type="button"
                  aria-label="Set maximum value"
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm border-2 border-white/90 bg-white/20 shadow hover:bg-white/40 focus-visible:outline-none"
                  style={{ left: maxPct, touchAction: "none" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    startDrag("max");
                  }}
                />
              </>
            )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-60 rounded-lg border border-white/[0.07] bg-card/80 p-2 font-mono shadow-black/20 shadow-lg backdrop-blur-md">
          <ColormapGrid active={colormap} onSelect={onColormapChange ?? (() => {})} />

          <ContextMenuSeparator />

          {/* Reverse + Reset range */}
          <div className="flex gap-1 px-1 py-0.5">
            <ActionButton active={reversed} onClick={() => onReversedChange?.(!reversed)}>
              ⇄ Reverse
            </ActionButton>
            <ActionButton disabled={onResetRange == null} onClick={onResetRange}>
              ↺ Reset range
            </ActionButton>
          </div>

          {/* Scale selector — wired but NOT in query key until backend ships */}
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

      {/* Min / max labels */}
      <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground/70 tabular-nums">
        <span>{formatValue(toVal(localMin))}</span>
        <span>{formatValue(toVal(localMax))}</span>
      </div>
    </div>
  );
}
