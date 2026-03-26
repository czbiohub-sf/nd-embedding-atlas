import { useEffect, useRef } from "react";
import { useLegendCounts } from "../../hooks/useLegendCounts";
import { useLegend } from "./LegendContext";

/**
 * Categorical color legend with interactive dot isolation and color picker popout.
 *
 * Each row: ● label ··· count [⬡]
 * - Click ● → isolate (dim others to 30%)
 * - Shift+Click ● → additive toggle
 * - Click [⬡] → popout color picker
 * - ESC → clear isolation or close picker
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
        <div ref={containerRef} className="legend-categorical">
            {legend.map((item) => {
                const isIsolated = isolatedIndices.has(item.index);
                const isDimmed = hasIsolation && !isIsolated;
                const c = counts?.get(item.index);
                const total = c?.total ?? item.count;
                const filtered = c?.filtered ?? total;
                const isFiltered = filtered !== total;

                return (
                    <div key={item.index} className={`legend-row${isDimmed ? "legend-row--dimmed" : ""}`}>
                        {/* Isolation dot */}
                        <button
                            type="button"
                            className={`legend-dot${isIsolated ? "legend-dot--isolated" : ""}`}
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
                            title={`Click to isolate, Shift+Click to add`}
                        />

                        {/* Label */}
                        <span className="legend-label">{item.label}</span>

                        {/* Count — shows "filtered / total" when cross-filter is active */}
                        <span className="legend-count">
                            {isFiltered ? (
                                <>
                                    <span className="legend-count-filtered">{filtered.toLocaleString()}</span>
                                    {` / ${total.toLocaleString()}`}
                                </>
                            ) : (
                                total.toLocaleString()
                            )}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
