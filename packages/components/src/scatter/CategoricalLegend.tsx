import { useEffect } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@ndea/ui/components/context-menu";
import { OklchColorPicker } from "@ndea/ui/components/oklch-color-picker";
import { hexToOklch, oklchToHex, type OklchColor } from "./helpers";
import { cn } from "@ndea/ui/lib/utils";
import { useLegend } from "./LegendContext";
import { useLegendCounts } from "./useLegendCounts";

/**
 * Categorical legend body (design data/Legend.jsx); the popover or the pinned
 * card around it supplies the frame.
 *
 * Each row: ● label ··· count
 * - Click a row → toggle it in the legend filter (isolation; others dim)
 * - Click ● → toggle hidden (dropped from drawing, picking and selection)
 * - Right-click ● → OklchColorPicker context menu
 * - Clear / Esc → clear the legend filter
 */
export function CategoricalLegend({ title }: { title: string }) {
  const { state, actions, meta } = useLegend();
  const { isolatedIndices, disabledIndices, colorOverrides } = state;
  const { legend, coordinator, selection, table, categoryCol, onStaleColumn } = meta;

  // Reactive filtered counts: updates when cross-filter changes
  const counts = useLegendCounts({ coordinator, selection, table, categoryCol, onStaleColumn });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isolatedIndices.size > 0) actions.clearIsolation();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isolatedIndices.size, actions]);

  if (legend.length === 0) return null;

  const hasIsolation = isolatedIndices.size > 0;

  return (
    <div className="flex min-w-40 flex-col gap-px">
      <div className="flex items-center gap-1.5 px-1.5 pt-[3px] pb-1">
        <span className="flex-1 truncate font-mono text-sm text-text-muted">{title}</span>
        {hasIsolation || disabledIndices.size > 0 ? (
          <button
            type="button"
            className="text-sm text-primary"
            onClick={() => {
              actions.clearIsolation();
              actions.clearDisabled();
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex max-h-60 flex-col gap-px overflow-y-auto">
        {legend.map((item) => {
          const isIsolated = isolatedIndices.has(item.index);
          const isDisabled = disabledIndices.has(item.index);
          const c = counts?.get(item.index);
          const total = c?.total ?? item.count;
          const filtered = c?.filtered ?? total;

          const baseColor = colorOverrides.get(item.index) ?? item.color;
          const defaultOklch: OklchColor = hexToOklch(item.color) ?? { l: 0.6, c: 0.15, h: 0 };
          const effectiveOklch: OklchColor = hexToOklch(baseColor) ?? defaultOklch;

          return (
            <div
              key={item.index}
              role="button"
              tabIndex={0}
              aria-pressed={isIsolated}
              className={cn(
                "flex cursor-pointer items-center gap-[7px] rounded-sm px-1.5 py-[3px] text-ui outline-none transition-opacity focus-visible:ring-1 focus-visible:ring-ring",
                isIsolated && "bg-muted",
                hasIsolation && !isIsolated && "opacity-45",
                isDisabled && "opacity-30",
              )}
              onClick={() => actions.toggleIsolation(item.index, true)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  actions.toggleIsolation(item.index, true);
                }
              }}
            >
              <ContextMenu>
                <ContextMenuTrigger
                  render={
                    <button
                      type="button"
                      className="size-2 shrink-0 cursor-pointer rounded-full border-0 p-0"
                      style={
                        isDisabled
                          ? { backgroundColor: "transparent", boxShadow: `inset 0 0 0 1.5px ${baseColor}` }
                          : { backgroundColor: baseColor }
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        actions.toggleDisabled(item.index);
                      }}
                      aria-pressed={isDisabled}
                      aria-label={`Hide ${item.label}`}
                      title="Click to hide · Right-click for color"
                    />
                  }
                />
                <ContextMenuContent className="w-52 font-mono">
                  <OklchColorPicker
                    label={item.label}
                    color={effectiveOklch}
                    defaultColor={defaultOklch}
                    onChange={(newColor) => actions.setColorOverride(item.index, oklchToHex(newColor))}
                    onReset={() => actions.clearColorOverride(item.index)}
                  />
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => actions.clearColorOverride(item.index)}>Reset color</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              <span className={cn("min-w-0 flex-1 truncate", isDisabled && "line-through")}>{item.label}</span>
              <span className="pl-1.5 font-mono text-xs text-text-muted tabular-nums">
                {filtered !== total ? (
                  <>
                    <span className="text-foreground">{filtered.toLocaleString()}</span>/{total.toLocaleString()}
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
  );
}
