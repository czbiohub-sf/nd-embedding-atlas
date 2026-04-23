import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * FilterBadge — shows filtered/total counts in a compact monospace format.
 *
 *   <FilterBadge filtered={123} total={4567} />    // "123 / 4,567"
 *   <FilterBadge total={4567} />                   // "4,567"
 *
 * Uses accent-cyan when a filter is active (matches StatusBar selection
 * highlight), text-muted-foreground otherwise.
 */

interface FilterBadgeProps extends Omit<React.ComponentPropsWithoutRef<"span">, "children"> {
  total: number;
  filtered?: number;
  /** Suffix label appended after the numbers (e.g. "points", "obs"). */
  label?: string;
}

function FilterBadge({ total, filtered, label, className, ...props }: FilterBadgeProps) {
  const isFiltered = filtered != null && filtered < total;

  return (
    <span
      data-slot="filter-badge"
      data-filtered={isFiltered}
      className={cn(
        "inline-flex items-baseline gap-1 font-mono text-2xs tabular-nums",
        isFiltered ? "text-accent-cyan" : "text-muted-foreground",
        className,
      )}
      {...props}
    >
      <span>
        {isFiltered && filtered != null
          ? `${filtered.toLocaleString()} / ${total.toLocaleString()}`
          : total.toLocaleString()}
      </span>
      {label && <span className="text-muted-foreground">{label}</span>}
    </span>
  );
}

export { FilterBadge };
export type { FilterBadgeProps };
