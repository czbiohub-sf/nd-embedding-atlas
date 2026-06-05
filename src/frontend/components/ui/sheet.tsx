"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { createContext, useContext, useRef } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Ref to the SheetContent's popup element. Exposed via context so descendants
 * (Combobox, Popover, etc.) can use it as a `collisionBoundary` so their
 * floating UI flips/clamps inside the sheet rather than the whole viewport.
 */
const SheetBoundaryContext = createContext<React.RefObject<HTMLDivElement | null> | null>(null);

/**
 * Read the nearest enclosing SheetContent's element ref. Returns null when
 * not inside a Sheet — components use that to fall back to viewport-bounded
 * positioning.
 */
export function useSheetBoundary(): HTMLElement | null {
  const ref = useContext(SheetBoundaryContext);
  return ref?.current ?? null;
}

function Sheet({ modal = false, ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" modal={modal} {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/80 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
}) {
  const boundaryRef = useRef<HTMLDivElement | null>(null);
  return (
    <SheetPortal>
      <SheetPrimitive.Popup
        ref={boundaryRef}
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col",
          "data-[side=right]:top-16 data-[side=right]:right-4",
          "data-[side=left]:top-16 data-[side=left]:left-4",
          "data-[side=top]:top-4 data-[side=top]:left-1/2 data-[side=top]:-translate-x-1/2",
          "data-[side=bottom]:bottom-4 data-[side=bottom]:left-1/2 data-[side=bottom]:-translate-x-1/2",
          "w-[360px] max-h-[calc(100vh-5rem)]",
          "rounded-xl border border-border bg-popover text-popover-foreground",
          "shadow-2xl ring-1 ring-black/5",
          "text-xs/relaxed",
          "transition duration-150 ease-out",
          "data-[side=right]:data-starting-style:translate-x-2 data-[side=right]:data-ending-style:translate-x-2",
          "data-[side=left]:data-starting-style:-translate-x-2 data-[side=left]:data-ending-style:-translate-x-2",
          "data-starting-style:opacity-0 data-ending-style:opacity-0",
          className,
        )}
        {...props}
      >
        <SheetBoundaryContext.Provider value={boundaryRef}>{children}</SheetBoundaryContext.Provider>
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2 h-7 w-7" />}
          >
            <XIcon className="h-3.5 w-3.5" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1 px-4 py-3 border-b border-border-subtle", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex items-center justify-end gap-2 px-4 py-3 border-t border-border-subtle", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-heading font-medium text-foreground text-[13px] tracking-tight", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-2xs text-muted-foreground leading-snug", className)}
      {...props}
    />
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
