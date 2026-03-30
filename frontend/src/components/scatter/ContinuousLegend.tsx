import { useCallback, useEffect, useRef, useState } from "react";
import { useColormapPalette } from "../../hooks/useColormaps";

interface Props {
  columnName: string;
  colormap: string;
  vmin: number;
  vmax: number;
  /** Full data range — defines slider bounds. Defaults to [vmin, vmax] if not provided. */
  absoluteVmin?: number;
  absoluteVmax?: number;
  /** Called on every move with the current range (real-time). */
  onRangeChange?: (vmin: number, vmax: number) => void;
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

export function ContinuousLegend({
  columnName,
  colormap,
  vmin,
  vmax,
  absoluteVmin,
  absoluteVmax,
  onRangeChange,
}: Props) {
  const paletteQuery = useColormapPalette(colormap, 16);
  const gradientStops = paletteQuery.data
    ? paletteQuery.data.join(", ")
    : (COLORMAP_FALLBACKS[colormap] ?? COLORMAP_FALLBACKS["viridis"]);

  const absMin = absoluteVmin ?? vmin;
  const absMax = absoluteVmax ?? vmax;
  const hasRange = absMax > absMin && onRangeChange != null;

  const toFrac = useCallback((v: number) => (absMax > absMin ? (v - absMin) / (absMax - absMin) : 0), [absMin, absMax]);
  const toVal = useCallback((f: number) => absMin + f * (absMax - absMin), [absMin, absMax]);

  const [localMin, setLocalMin] = useState(() => toFrac(vmin));
  const [localMax, setLocalMax] = useState(() => toFrac(vmax));

  // Refs kept in sync for use inside window-level event handlers (avoids stale closure)
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

  // Sync from props when not dragging (e.g. column change)
  useEffect(() => {
    if (!draggingRef.current) {
      setLocalMin(toFrac(vmin));
      setLocalMax(toFrac(vmax));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmin, vmax, absMin, absMax]);

  function fracFromClientX(clientX: number): number {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  // Use window-level listeners (same pattern as useScatterInteraction) so events
  // fire reliably when the pointer moves outside the button element.
  const startDrag = useCallback((which: "min" | "max") => {
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
  }, []);

  const minPct = `${(localMin * 100).toFixed(1)}%`;
  const maxPct = `${(localMax * 100).toFixed(1)}%`;

  return (
    <div className="absolute left-2 top-10 z-20 w-44 rounded-lg border border-border/30 bg-card/80 backdrop-blur-md p-2.5">
      {/* Column name */}
      <p className="mb-1.5 truncate text-[10px] font-mono text-muted-foreground" title={columnName}>
        {columnName}
      </p>

      {/* Gradient bar with inline drag handles */}
      <div ref={barRef} className="relative h-3 w-full rounded-sm select-none">
        {/* Full gradient underneath */}
        <div
          className="absolute inset-0 rounded-sm"
          style={{ background: `linear-gradient(to right, ${gradientStops})` }}
        />

        {hasRange && (
          <>
            {/* Dimmed overlay — left of min handle */}
            <div className="absolute inset-y-0 left-0 rounded-l-sm bg-black/50" style={{ width: minPct }} />
            {/* Dimmed overlay — right of max handle */}
            <div
              className="absolute inset-y-0 right-0 rounded-r-sm bg-black/50"
              style={{ width: `${((1 - localMax) * 100).toFixed(1)}%` }}
            />

            {/* Min handle */}
            <button
              type="button"
              aria-label="Set minimum value"
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 size-3 cursor-ew-resize rounded-sm border-2 border-white/90 bg-white/20 shadow hover:bg-white/40 focus-visible:outline-none"
              style={{ left: minPct, touchAction: "none" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                startDrag("min");
              }}
            />

            {/* Max handle */}
            <button
              type="button"
              aria-label="Set maximum value"
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 size-3 cursor-ew-resize rounded-sm border-2 border-white/90 bg-white/20 shadow hover:bg-white/40 focus-visible:outline-none"
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

      {/* Min / max labels */}
      <div className="mt-1 flex justify-between text-[9px] font-mono tabular-nums text-muted-foreground/70">
        <span>{formatValue(toVal(localMin))}</span>
        <span>{formatValue(toVal(localMax))}</span>
      </div>
    </div>
  );
}
