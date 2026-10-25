import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@ndea/ui/lib/utils";
import { HoverTip } from "./hover-tip";

/**
 * IconButton: icon-only chrome control with a built-in tooltip (design core/IconButton.jsx).
 *
 * Every icon-only button uses it: `label` is the accessible name and tooltip
 * title; `description` is an optional second tooltip line. `pressed` mirrors
 * aria-pressed and fills with the accent. Toolbars that compose their own
 * HoverTip + ToggleGroupItem reuse `iconButtonVariants` for the same look.
 */

const iconButtonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center",
    "rounded-xs bg-transparent text-text-muted outline-none",
    "hover:bg-muted hover:text-foreground",
    "aria-pressed:bg-accent aria-pressed:text-accent-foreground data-pressed:bg-accent data-pressed:text-accent-foreground",
    "focus-visible:ring-1 focus-visible:ring-ring",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
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
    /** Accessible name and tooltip title. */
    label: string;
    /** Optional one-phrase second tooltip line. */
    description?: string;
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
