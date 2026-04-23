import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * LegendRow — interactive categorical legend entry: [swatch] [label] [count].
 *
 * Supports three visual states via props:
 *   disabled — hollow outline dot, 30% opacity.
 *   isolated — ring around the dot (ring-1 ring-current ring-offset-1).
 *   dimmed   — 40% row opacity (siblings when one is isolated).
 *
 * Lifts the duplicated dot/row logic from CategoricalLegend into a shared
 * primitive. Swatch is rendered by caller-supplied `swatch` prop because
 * CategoricalLegend wraps the swatch in a ContextMenu; this keeps the
 * primitive agnostic about interaction semantics.
 */

interface LegendRowProps extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  swatch: React.ReactNode;
  label: React.ReactNode;
  count?: React.ReactNode;
  disabled?: boolean;
  isolated?: boolean;
  dimmed?: boolean;
}

function LegendRow({
  swatch,
  label,
  count,
  disabled,
  isolated: _isolated,
  dimmed,
  className,
  onClick,
  ...props
}: LegendRowProps) {
  return (
    <div
      data-slot="legend-row"
      data-disabled={disabled || undefined}
      data-dimmed={dimmed || undefined}
      className={cn(
        "flex cursor-default items-center gap-2 rounded px-1 py-0.5 text-2xs transition-opacity",
        dimmed && "opacity-40",
        !dimmed && !disabled && "opacity-80 hover:opacity-100",
        disabled && "opacity-30",
        className,
      )}
      onClick={onClick}
      {...props}
    >
      {swatch}
      <span data-slot="legend-label" className="min-w-0 flex-1 truncate text-foreground/90">
        {label}
      </span>
      {count != null && (
        <span data-slot="legend-count" className="shrink-0 font-mono text-muted-foreground tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

export { LegendRow };
export type { LegendRowProps };
