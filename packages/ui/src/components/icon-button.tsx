import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@ndea/ui/lib/utils";
import { HoverTip } from "./hover-tip";

/**
 * IconButton: standalone icon-only chrome control with a required tooltip.
 *
 * Use for general chrome (panels, headers, future toolbars) needing a single
 * tooltipped icon button. NOT for:
 *  - canvas instrument buttons → use `nd-icon-button` (same Base UI Button
 *    base, tiny instrument styling, data-nodrag);
 *  - toolbars that group controls in a ToggleGroup and tip them uniformly
 *    (e.g. ScatterToolbar derives its buttons from `iconButtonVariants`
 *    directly, keeping HoverTip + ToggleGroupItem composition caller-side).
 *
 * Shares `iconButtonVariants` with those callers so the icon-button look has
 * one source. Enforces the tooltip via required `label` + `description` :
 * icon-only controls without an accessible name fail a11y. `pressed` mirrors
 * aria-pressed for toggle semantics.
 */

const iconButtonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center",
    "rounded-md bg-transparent text-muted-foreground transition-colors",
    "hover:bg-foreground/10 hover:text-foreground",
    "aria-pressed:text-foreground",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ),
  {
    variants: {
      size: {
        sm: "size-[22px] [&_svg:not([class*='size-'])]:size-3",
        md: "size-[26px] [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: { size: "sm" },
  },
);

type IconButtonProps = Omit<React.ComponentPropsWithoutRef<"button">, "children"> &
  VariantProps<typeof iconButtonVariants> & {
    /** Icon element: single svg or similar. */
    children: React.ReactNode;
    /** Bold label shown in the tooltip. */
    label: string;
    /** One-phrase description shown in the tooltip. */
    description: string;
    /** Tooltip side. Defaults to bottom. */
    tooltipSide?: "top" | "bottom" | "left" | "right";
    /** aria-pressed mirror for toggle usage. */
    pressed?: boolean;
  };

function IconButton({
  className,
  size,
  label,
  description,
  tooltipSide,
  pressed,
  children,
  ...props
}: IconButtonProps) {
  return (
    <HoverTip
      label={label}
      description={description}
      side={tooltipSide ?? "bottom"}
      render={
        <ButtonPrimitive
          data-slot="icon-button"
          aria-pressed={pressed}
          aria-label={label}
          className={cn(iconButtonVariants({ size }), className)}
          {...props}
        />
      }
    >
      {children}
    </HoverTip>
  );
}

export { IconButton, iconButtonVariants };
export type { IconButtonProps };
