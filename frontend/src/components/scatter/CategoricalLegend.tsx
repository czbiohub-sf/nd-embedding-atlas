import { useEffect, useRef } from "react";
import { useLegendCounts } from "../../hooks/useLegendCounts";
import { hexToOklch, oklchToHex } from "@/lib/color-conversions";
import type { OklchColor } from "@/lib/color-conversions";
import { OklchColorPicker } from "@/components/ui/oklch-color-picker";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useLegend } from "./LegendContext";

/**
 * Categorical color legend with interactive dot disable + isolation.
 *
 * Each row: ● label ··· count
 * - Left-click ● → toggle disabled (hidden from scatter, alpha=0)
 * - Shift+Click row → additive isolation toggle (dims others)
 * - Right-click ● → OklchColorPicker context menu
 * - ESC → clear isolation
 */
export function CategoricalLegend() {
  const { state, actions, meta } = useLegend();
  const { isolatedIndices, disabledIndices, colorOverrides } = state;
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
      className="absolute left-2 top-10 z-20 w-52 rounded-lg border border-white/[0.07] bg-card/80 backdrop-blur-md text-[11px] font-mono"
    >
      <div className="px-2.5 pt-2 pb-1 text-[10px] text-text-muted uppercase tracking-wider">
        Categories · {legend.length}
      </div>
      <div className="overflow-y-auto max-h-[200px] px-2.5 pb-2">
        <div className="flex flex-col gap-0.5">
          {legend.map((item) => {
            const isIsolated = isolatedIndices.has(item.index);
            const isDisabled = disabledIndices.has(item.index);
            // Dimmed: isolation active and this item is not isolated (and not already disabled)
            const isDimmed = hasIsolation && !isIsolated && !isDisabled;
            const c = counts?.get(item.index);
            const total = c?.total ?? item.count;
            const filtered = c?.filtered ?? total;
            const isFiltered = filtered !== total;

            // Base color respects overrides; disabled items show as hollow outline
            const baseColor = colorOverrides.get(item.index) ?? item.color;
            const defaultOklch: OklchColor = hexToOklch(item.color) ?? { l: 0.6, c: 0.15, h: 0 };
            const effectiveOklch: OklchColor = hexToOklch(baseColor) ?? defaultOklch;

            // Disabled dot: transparent fill with colored border
            const dotStyle: React.CSSProperties = isDisabled
              ? { backgroundColor: "transparent", border: `1.5px solid ${baseColor}`, opacity: 0.5 }
              : { backgroundColor: baseColor };

            return (
              <div
                key={item.index}
                className={cn(
                  "flex items-center gap-2 py-0.5 rounded px-1 transition-opacity cursor-default",
                  isDimmed && "opacity-40",
                  !isDimmed && !isDisabled && "opacity-80 hover:opacity-100",
                  isDisabled && "opacity-30",
                )}
                onClick={(e) => {
                  // Shift+click anywhere on the row = additive isolation
                  if (e.shiftKey) actions.toggleIsolation(item.index, true);
                }}
              >
                {/* Color dot — left-click toggles disabled, right-click opens color picker */}
                <ContextMenu>
                  <ContextMenuTrigger>
                    <button
                      type="button"
                      className={cn(
                        "inline-block h-2.5 w-2.5 shrink-0 rounded-full border-0 p-0 cursor-pointer transition-[box-shadow]",
                        isIsolated && !isDisabled && "ring-1 ring-offset-1 ring-current",
                      )}
                      style={dotStyle}
                      onClick={(e) => {
                        // Guard: Shift+click is handled by the row div for isolation
                        if (e.shiftKey) return;
                        e.stopPropagation();
                        actions.toggleDisabled(item.index);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          if (!e.shiftKey) actions.toggleDisabled(item.index);
                        }
                      }}
                      aria-pressed={isDisabled}
                      aria-label={`Toggle ${item.label} visibility`}
                      title="Click to toggle visibility · Shift+Click to isolate · Right-click for color"
                    />
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-52 p-1 font-mono rounded-lg border border-white/[0.07] bg-card/80 backdrop-blur-md shadow-lg shadow-black/20">
                    <OklchColorPicker
                      label={item.label}
                      color={effectiveOklch}
                      defaultColor={defaultOklch}
                      onChange={(newColor) => actions.setColorOverride(item.index, oklchToHex(newColor))}
                      onReset={() => actions.clearColorOverride(item.index)}
                    />
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => actions.clearColorOverride(item.index)}>
                      ↺ Reset color
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>

                {/* Label */}
                <span
                  className={cn(
                    "flex-1 truncate text-text-secondary",
                    isDisabled && "line-through opacity-60",
                  )}
                >
                  {item.label}
                </span>

                {/* Count */}
                <span className={cn("text-text-muted shrink-0", isDisabled && "opacity-40")}>
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
