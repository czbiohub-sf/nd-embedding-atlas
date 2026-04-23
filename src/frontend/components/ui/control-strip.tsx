import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * ControlStrip — dense horizontal toolbar container.
 *
 * Used across ScatterControlStrip, ScatterOverlayControls top-left,
 * BottomDock toolbar sections. Collapses the repeated
 *   `flex shrink-0 items-center gap-1 border-b px-2 py-1 text-2xs`
 * pattern.
 *
 * <ControlStrip>
 *   <ControlStrip.Group>
 *     <IconButton label="…" description="…">…</IconButton>
 *   </ControlStrip.Group>
 *   <ControlStrip.Divider />
 *   <ControlStrip.Group>…</ControlStrip.Group>
 * </ControlStrip>
 */

function ControlStrip({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="control-strip"
      className={cn("flex shrink-0 items-center gap-1 px-2 py-1 text-2xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function ControlStripGroup({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div data-slot="control-strip-group" className={cn("flex items-center gap-0.5", className)} {...props} />;
}

function ControlStripDivider({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="control-strip-divider"
      aria-hidden
      className={cn("mx-1 h-3.5 w-px shrink-0 bg-border", className)}
      {...props}
    />
  );
}

ControlStrip.Group = ControlStripGroup;
ControlStrip.Divider = ControlStripDivider;

export { ControlStrip };
