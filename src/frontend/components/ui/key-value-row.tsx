import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * KeyValueRow — label/value pair with monospace right-aligned value.
 *
 * For metadata displays where you want the keys left-aligned and truncated,
 * and the values right-aligned with tabular numerals. Value area accepts
 * children so callers can drop in badges, pills, or multi-part content.
 */

interface KeyValueRowProps extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  label: React.ReactNode;
  children: React.ReactNode;
  /** Max width for the label column (Tailwind class). */
  labelClassName?: string;
}

function KeyValueRow({ label, children, className, labelClassName, ...props }: KeyValueRowProps) {
  return (
    <div data-slot="kv-row" className={cn("flex items-baseline justify-between gap-3 text-2xs", className)} {...props}>
      <span
        data-slot="kv-label"
        className={cn("max-w-[90px] shrink-0 truncate text-muted-foreground/70", labelClassName)}
      >
        {label}
      </span>
      <span data-slot="kv-value" className="min-w-0 truncate text-right text-foreground/90 tabular-nums">
        {children}
      </span>
    </div>
  );
}

export { KeyValueRow };
export type { KeyValueRowProps };
