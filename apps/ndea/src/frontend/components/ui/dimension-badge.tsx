import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DimensionBadge: small technical label for layers, categories, dimensions.
 *
 * Replaces inline badges in ColorSourcePicker (obs/var badges) and similar
 * dimension labelers that repeat a `shrink-0 rounded-sm border … text-3xs`
 * class bundle.
 *
 *   <DimensionBadge tone="obs">obs</DimensionBadge>
 *   <DimensionBadge tone="var">{layer}</DimensionBadge>
 */

const dimensionBadgeVariants = cva(
  "inline-flex shrink-0 items-center rounded-sm border px-1 font-sans text-3xs leading-none",
  {
    variants: {
      tone: {
        obs: "border-blue-500/30 bg-blue-500/20 text-blue-400",
        var: "border-emerald-500/30 bg-emerald-500/20 text-emerald-400",
        accent: "border-primary/30 bg-primary/15 text-primary",
        amber: "border-wire-sel/35 bg-wire-sel/15 text-amber-400",
        muted: "border-border bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

type DimensionBadgeProps = React.ComponentPropsWithoutRef<"span"> & VariantProps<typeof dimensionBadgeVariants>;

function DimensionBadge({ className, tone, ...props }: DimensionBadgeProps) {
  return <span data-slot="dimension-badge" className={cn(dimensionBadgeVariants({ tone }), className)} {...props} />;
}

export { DimensionBadge, dimensionBadgeVariants };
export type { DimensionBadgeProps };
