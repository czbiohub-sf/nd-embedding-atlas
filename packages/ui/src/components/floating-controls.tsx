/**
 * Controls that float over a view's canvas (design core/OverlayControls.jsx):
 * the control group of 26px buttons and the popovers they open. Solid overlay
 * fill, no blur.
 */

import type { ReactNode } from "react";
import { HoverTip } from "@ndea/ui/components/hover-tip";
import { iconButtonVariants } from "@ndea/ui/components/icon-button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  popoverHeading,
} from "@ndea/ui/components/popover";
import { cn } from "@ndea/ui/lib/utils";

/** The surface of every control floating over a view. */
export const overlaySurface = "bg-overlay shadow-(--shadow-popover)";
const NESTED_POPUP = "[data-slot=popover-content], [data-slot=select-content], [data-slot=context-menu-content]";

/** The one column of 26px buttons, top-left inside the view. */
export function ControlGroup({ children }: { children: ReactNode }) {
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      className={cn("absolute top-2 left-2 z-20 flex flex-col gap-0.5 rounded-lg p-0.5", overlaySurface)}
    >
      {children}
    </div>
  );
}

export function ControlDivider() {
  return <span aria-hidden className="mx-[3px] my-px h-px bg-border" />;
}

/** A control-group button that opens a popover beside the group. */
export function ControlPopover({
  icon,
  label,
  description,
  title,
  action,
  side = "right",
  className = "w-60",
  children,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  title: string;
  /** Right side of the popover header, e.g. the legend's pin toggle. */
  action?: ReactNode;
  /** Where the popover opens; the image viewer opens below on narrow views. */
  side?: "right" | "bottom";
  className?: string;
  children: ReactNode;
}) {
  return (
    // A press in, or focus moving to, a pop-up opened from this one (color-by, palette, a select) is not outside.
    <Popover
      onOpenChange={(open, details) => {
        const { event, reason } = details;
        const target = event instanceof FocusEvent ? event.relatedTarget : event.target;
        if (
          !open &&
          (reason === "outside-press" || reason === "focus-out") &&
          target instanceof Element &&
          target.closest(NESTED_POPUP)
        )
          details.cancel();
      }}
    >
      <HoverTip
        label={label}
        description={description}
        side="right"
        render={<PopoverTrigger aria-label={label} className={iconButtonVariants({ size: "md" })} />}
      >
        {icon}
      </HoverTip>
      <PopoverContent side={side} align="start" sideOffset={6} className={className}>
        <PopoverHeader className="items-center">
          <PopoverTitle className="flex-1">{title}</PopoverTitle>
          {action}
        </PopoverHeader>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Labelled row inside a control popover. */
export function ControlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[26px] items-center gap-2 px-1.5">
      <span className="w-16 shrink-0 text-sm text-text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end">{children}</div>
    </div>
  );
}

export function ControlHeading({ children }: { children: ReactNode }) {
  return <div className={popoverHeading}>{children}</div>;
}
