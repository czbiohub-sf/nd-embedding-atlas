import { useEffect, useRef } from "react";
import { useLegendCounts } from "../../hooks/useLegendCounts";
import { useLegend } from "./LegendContext";

/**
 * Categorical color legend with interactive dot isolation.
 *
 * Each row: ● label ··· count
 * - Click ● → isolate (dim others to 30%)
 * - Shift+Click ● → additive toggle
 * - ESC → clear isolation
 */
export function CategoricalLegend() {
  const { state, actions, meta } = useLegend();
  const { isolatedIndices } = state;
  const { legend, coordinator, selection, table, categoryCol } = meta;
  const containerRef = useRef<HTMLDivElement>(null);

  // Reactive filtered counts — updates when cross-filter changes
  const counts = useLegendCounts({ coordinator, selection, table, categoryCol });

  // ESC handler: clear isolation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isolatedIndices.size > 0) {
        actions.clearIsolation();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isolatedIndices.size, actions]);

  if (legend.length === 0) return null;

  const hasIsolation = isolatedIndices.size > 0;

  return (
    <div
      ref={containerRef}
      className="absolute left-2 top-10 z-20 w-52 rounded-lg border border-border/30 bg-card/80 backdrop-blur-md text-[11px] font-mono"
    >
      <div className="px-2.5 pt-2 pb-1 text-[10px] text-text-muted uppercase tracking-wider">
        Categories · {legend.length}
      </div>
      <div className="overflow-y-auto max-h-[200px] px-2.5 pb-2">
        <div className="flex flex-col gap-0.5">
          {legend.map((item) => {
            const isIsolated = isolatedIndices.has(item.index);
            const isDimmed = hasIsolation && !isIsolated;
            const c = counts?.get(item.index);
            const total = c?.total ?? item.count;
            const filtered = c?.filtered ?? total;
            const isFiltered = filtered !== total;

            return (
              <div
                key={item.index}
                className={`flex items-center gap-2 py-0.5 rounded px-1 transition-opacity cursor-default${isDimmed ? " opacity-40" : " opacity-80 hover:opacity-100"}`}
              >
                {/* Isolation dot */}
                <button
                  type="button"
                  className={`inline-block h-2 w-2 shrink-0 rounded-full border-0 p-0 cursor-pointer transition-[box-shadow]${isIsolated ? " ring-1 ring-offset-1 ring-current" : ""}`}
                  style={{ backgroundColor: item.color }}
                  onClick={(e) => actions.toggleIsolation(item.index, e.shiftKey)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      actions.toggleIsolation(item.index, e.shiftKey);
                    }
                  }}
                  aria-pressed={isIsolated}
                  aria-label={`Isolate ${item.label}`}
                  title="Click to isolate, Shift+Click to add"
                />

                {/* Label */}
                <span className="flex-1 truncate text-text-secondary">{item.label}</span>

                {/* Count */}
                <span className="text-text-muted shrink-0">
                  {isFiltered ? (
                    <>
                      <span className="text-accent-cyan">{filtered.toLocaleString()}</span>
                      {`/${total.toLocaleString()}`}
                    </>
                  ) : (
                    total.toLocaleString()
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
