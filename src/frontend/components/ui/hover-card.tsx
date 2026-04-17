"use client";

/**
 * HoverCard — open-on-hover Popover with a small delay.
 *
 * Built on top of @base-ui/react/popover with `openOnHover` enabled.
 * Mirrors the shadcn-style API: HoverCard / HoverCardTrigger / HoverCardContent.
 */

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

interface HoverCardProps {
  children?: React.ReactNode;
  openOnHover?: boolean;
  delay?: number;
  closeDelay?: number;
}

function HoverCard({ openOnHover = true, delay = 300, closeDelay = 120, children }: HoverCardProps) {
  return (
    <PopoverPrimitive.Root data-slot="hover-card" openOnHover={openOnHover} delay={delay} closeDelay={closeDelay}>
      {children}
    </PopoverPrimitive.Root>
  );
}

function HoverCardTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

function HoverCardContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-popover"
      >
        <PopoverPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 origin-(--transform-origin) rounded-lg bg-popover p-2 text-popover-foreground text-xs shadow-md outline-hidden ring-1 ring-foreground/10 duration-100 data-closed:animate-out data-open:animate-in",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
