import { useCallback, useEffect, useRef, useState } from "react";
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
    const { isolatedIndices, colorOverrides } = state;
    const { legend, coordinator, selection, table, categoryCol } = meta;
    const [pickerIndex, setPickerIndex] = useState<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Reactive filtered counts — updates when cross-filter changes
    const counts = useLegendCounts({ coordinator, selection, table, categoryCol });

    // ESC handler: close picker first, then clear isolation
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (pickerIndex !== null) {
                    setPickerIndex(null);
                } else if (isolatedIndices.size > 0) {
                    actions.clearIsolation();
                }
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [pickerIndex, isolatedIndices.size, actions]);

    // Click outside to close picker
    useEffect(() => {
        if (pickerIndex === null) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setPickerIndex(null);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [pickerIndex]);

    const handleDotClick = useCallback(
        (index: number, e: React.MouseEvent) => {
            actions.toggleIsolation(index, e.shiftKey);
        },
        [actions],
    );

    const handleDotKeyDown = useCallback(
        (index: number, e: React.KeyboardEvent) => {
            if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                actions.toggleIsolation(index, e.shiftKey);
            }
        },
        [actions],
    );

    const handlePickerToggle = useCallback((index: number) => {
        setPickerIndex((prev) => (prev === index ? null : index));
    }, []);

    if (legend.length === 0) return null;

    const hasIsolation = isolatedIndices.size > 0;

    return (
        <div ref={containerRef} className="legend-categorical">
            {legend.map((item) => {
                const isIsolated = isolatedIndices.has(item.index);
                const isDimmed = hasIsolation && !isIsolated;
                const currentColor = colorOverrides.get(item.index) ?? item.color;
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
                            style={{ backgroundColor: currentColor }}
                            onClick={(e) => handleDotClick(item.index, e)}
                            onKeyDown={(e) => handleDotKeyDown(item.index, e)}
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

                        {/* Color picker button */}
                        <button
                            type="button"
                            className="legend-picker-btn"
                            onClick={() => handlePickerToggle(item.index)}
                            aria-label={`Change color for ${item.label}`}
                            aria-haspopup="dialog"
                            title="Change color"
                        >
                            ⬡
                        </button>

                        {/* Color picker popout */}
                        {pickerIndex === item.index ? (
                            <div className="legend-picker-popout">
                                <input
                                    type="color"
                                    value={currentColor}
                                    onChange={(e) => actions.setColorOverride(item.index, e.target.value)}
                                />
                                <span className="legend-picker-hex">{currentColor}</span>
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
