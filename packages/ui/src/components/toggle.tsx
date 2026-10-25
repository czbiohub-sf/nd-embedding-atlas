"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@ndea/ui/lib/utils";

/**
 * default: icon/text toggle with the IconButton look (pressed = accent fill).
 * segmented: option inside a segmented ToggleGroup (design navigation/SegmentedControl.jsx):
 * pressed = raised card thumb on the muted track.
 */
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-xs text-text-muted outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:stroke-[1.5] [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "bg-transparent hover:bg-muted hover:text-foreground data-pressed:bg-accent data-pressed:text-accent-foreground",
        segmented:
          "rounded-sm bg-transparent hover:text-foreground data-pressed:bg-card data-pressed:text-foreground data-pressed:shadow-(--shadow-raised)",
      },
      size: {
        default: "h-[26px] min-w-[26px] px-1.5 text-ui",
        sm: "h-[22px] min-w-[22px] px-1 text-ui-sm [&_svg:not([class*='size-'])]:size-3",
      },
    },
    compoundVariants: [{ variant: "segmented", className: "h-auto min-w-0 px-[9px] py-[3px] text-ui-sm" }],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return <TogglePrimitive data-slot="toggle" className={cn(toggleVariants({ variant, size, className }))} {...props} />;
}

export { Toggle, toggleVariants };
