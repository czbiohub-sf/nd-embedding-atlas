"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type * as React from "react";

import { cn } from "@ndea/ui/lib/utils";

/**
 * The one pop-up frame (design overlay/Popover.jsx), shared by popover, select,
 * menus, combobox, command, dialog and tooltip: card surface, keyline + shadow
 * (no border), 8.4px radius, 6px inset, 4px-rise open. Close is instant.
 */
const popoverFrame =
  "rounded-lg bg-card p-1.5 text-popover-foreground text-ui shadow-(--shadow-popover) outline-none origin-(--transform-origin) data-open:animate-nd-in";

/** Row inside the frame (design overlay/Menu.jsx): 6×8px, 4.9px radius, muted highlight. */
const popoverRow =
  "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-ui outline-hidden data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0";

/** Section heading inside the frame. */
const popoverHeading = "px-2 pt-2 pb-[3px] text-sm text-text-muted";

/** Keyline separator inside the frame. */
const popoverSeparator = "mx-1.5 my-1 h-(--keyline) bg-border";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  collisionBoundary,
  collisionPadding,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "collisionBoundary" | "collisionPadding"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        className="isolate z-popover"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(popoverFrame, "flex w-(--popover-width) flex-col gap-1.5", className)}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="popover-header" className={cn("flex items-baseline gap-1.5 px-1.5 pt-1", className)} {...props} />
  );
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return <PopoverPrimitive.Title data-slot="popover-title" className={cn("font-semibold", className)} {...props} />;
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("truncate text-sm text-text-muted", className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  popoverFrame,
  popoverHeading,
  popoverRow,
  popoverSeparator,
};
