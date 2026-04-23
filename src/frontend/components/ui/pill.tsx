import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Pill — inline tone-tinted chip for counts, statuses, selection markers.
 *
 * Lightweight sibling of Badge (which uses the primary color scheme).
 * Uses --*-emphasis tokens as background for low-intensity emphasis.
 *
 *   <Pill tone="info">{filteredCount} active</Pill>
 *   <Pill tone="danger">error</Pill>
 */

const pillVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0 text-3xs font-medium leading-[1.4] tabular-nums",
  {
    variants: {
      tone: {
        info: "bg-emphasis text-foreground",
        success: "bg-success-emphasis text-foreground",
        warning: "bg-warning-emphasis text-foreground",
        danger: "bg-danger-emphasis text-foreground",
        muted: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

type PillProps = React.ComponentPropsWithoutRef<"span"> & VariantProps<typeof pillVariants>;

function Pill({ className, tone, ...props }: PillProps) {
  return <span data-slot="pill" className={cn(pillVariants({ tone }), className)} {...props} />;
}

export { Pill, pillVariants };
export type { PillProps };
