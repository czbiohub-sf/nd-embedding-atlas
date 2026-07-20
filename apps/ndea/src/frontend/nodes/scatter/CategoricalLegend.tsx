import { useEffect, useRef } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { OklchColorPicker } from "@/components/ui/oklch-color-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { OklchColor } from "@/lib/color/color-conversions";
import { hexToOklch, oklchToHex } from "@/lib/color/color-conversions";
import { cn } from "@/lib/utils";
import { CategoricalPaletteGrid } from "./CategoricalPaletteGrid";
import { useLegend } from "./LegendContext";
import { useLegendCounts } from "./useLegendCounts";

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
  const { legend, coordinator, selection, table, categoryCol, onStaleColumn } = meta;
  const containerRef = useRef<HTMLDivElement>(null);

  // Reactive filtered counts: updates when cross-filter changes
  const counts = useLegendCounts({ coordinator, selection, table, categoryCol, onStaleColumn });

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
    <div ref={containerRef} className="absolute top-2 left-2 z-20 w-52 rounded-lg border glass font-mono text-2xs">
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1 text-3xs text-muted-foreground uppercase tracking-wider">
        <span>Categories · {legend.length}</span>
        <Popover>
          <PopoverTrigger
            aria-label="Change palette"
            title={`Palette · ${state.categoricalColormap}`}
            className="rounded-sm px-1 py-0.5 font-mono text-3xs text-muted-foreground/70 normal-case outline-none transition-colors focus-ring hover:bg-muted hover:text-foreground"
          >
            {state.categoricalColormap} ▾
          </PopoverTrigger>
          <PopoverContent align="end" className="w-60 rounded-lg border glass p-2 font-mono shadow-black/20 shadow-lg">
            <CategoricalPaletteGrid active={state.categoricalColormap} onSelect={actions.setCategoricalColormap} />
          </PopoverContent>
        </Popover>
      </div>
      <div className="max-h-[200px] overflow-y-auto px-2.5 pb-2">
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
            const defaultOklch: OklchColor = hexToOklch(item.color) ?? {
              l: 0.6,
              c: 0.15,
              h: 0,
            };
            const effectiveOklch: OklchColor = hexToOklch(baseColor) ?? defaultOklch;

            // Disabled dot: transparent fill with colored border
            const dotStyle: React.CSSProperties = isDisabled
              ? {
                  backgroundColor: "transparent",
                  border: `1.5px solid ${baseColor}`,
                  opacity: 0.5,
                }
              : { backgroundColor: baseColor };

            return (
              <div
                key={item.index}
                className={cn(
                  "flex cursor-default items-center gap-2 rounded px-1 py-0.5 transition-opacity",
                  isDimmed && "opacity-40",
                  !isDimmed && !isDisabled && "opacity-80 hover:opacity-100",
                  isDisabled && "opacity-30",
                )}
                onClick={(e) => {
                  // Shift+click anywhere on the row = additive isolation
                  if (e.shiftKey) actions.toggleIsolation(item.index, true);
                }}
              >
                {/* Color dot: left-click toggles disabled, right-click opens color picker */}
                <ContextMenu>
                  <ContextMenuTrigger>
                    <button
                      type="button"
                      className={cn(
                        "inline-block h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full border-0 p-0 transition-[box-shadow]",
                        isIsolated && !isDisabled && "ring-1 ring-current ring-offset-1",
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
                  <ContextMenuContent className="w-52 rounded-lg border glass p-1 font-mono shadow-black/20 shadow-lg">
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
                <span className={cn("flex-1 truncate text-muted-foreground", isDisabled && "line-through opacity-60")}>
                  {item.label}
                </span>

                {/* Count */}
                <span className={cn("shrink-0 text-muted-foreground", isDisabled && "opacity-40")}>
                  {isFiltered ? (
                    <>
                      <span className="text-primary">{filtered.toLocaleString()}</span>
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
