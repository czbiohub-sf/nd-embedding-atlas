import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Callout — tone-tinted banner for status / info / warnings / errors.
 *
 * Uses the --*-emphasis token family from Phase 1 so light/dark swap
 * automatically. Candidates for migration: FilterInfo, PanelErrorBoundary,
 * CommandPalette error states.
 *
 *   <Callout tone="warning" icon={<AlertIcon />}>Schema changed — reload.</Callout>
 */

const calloutVariants = cva(
  "flex items-start gap-2 rounded-md px-2.5 py-1.5 text-2xs leading-snug [&_svg]:mt-[0.5px] [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        info: "bg-emphasis text-foreground [&_svg]:text-accent-foreground",
        success: "bg-success-emphasis text-foreground",
        warning: "bg-warning-emphasis text-foreground",
        danger: "bg-danger-emphasis text-foreground",
      },
    },
    defaultVariants: { tone: "info" },
  },
);

type CalloutProps = React.ComponentPropsWithoutRef<"div"> &
  VariantProps<typeof calloutVariants> & {
    icon?: React.ReactNode;
  };

function Callout({ className, tone, icon, children, ...props }: CalloutProps) {
  return (
    <div data-slot="callout" className={cn(calloutVariants({ tone }), className)} role="status" {...props}>
      {icon}
      <div data-slot="callout-body" className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}

export { Callout, calloutVariants };
export type { CalloutProps };
