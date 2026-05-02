import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { HoverTip } from "./hover-tip";

/**
 * IconButton — icon-only control with required tooltip.
 *
 * Consolidates ~20 call sites in BottomDock, ScatterOverlayControls,
 * and toolbar strips that repeat:
 *
 *   <HoverTip label="…" description="…" render={
 *     <ToggleGroupItem className="size-[22px] …"><Icon /></ToggleGroupItem>
 *   } />
 *
 * Enforces the tooltip via required `label` + `description` props —
 * icon-only controls without labels fail accessibility without one.
 * Caller passes `pressed` for toggle semantics (aria-pressed).
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
    /** Icon element — single svg or similar. */
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
