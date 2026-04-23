import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Panel — surface container for docked cards and floating HUDs.
 *
 * Variants collapse the current ad-hoc patterns:
 *   solid  — `bg-card` sidebar/docked surfaces.
 *   glass  — frosted overlay using --glass-bg / --glass-border / --blur-glass.
 *            Replaces `rounded-lg border border-white/[0.07] bg-card/80
 *            backdrop-blur-md` scattered across ~10 files.
 *   ghost  — transparent; for caller-provided backgrounds (mixed layouts).
 *
 * depth controls shadow intensity (0..3). Use 0 for docked panels flush
 * against other panels, 1–2 for floating HUDs, 3 for modal-like overlays.
 *
 * Compound usage:
 *   <Panel variant="glass">
 *     <Panel.Header>Channels</Panel.Header>
 *     <Panel.Body>…</Panel.Body>
 *   </Panel>
 */

const panelVariants = cva("overflow-hidden rounded-lg border", {
  variants: {
    variant: {
      solid: "border-border bg-card text-card-foreground",
      glass:
        "border-glass-border bg-glass-bg text-card-foreground backdrop-blur-[var(--blur-glass)] backdrop-saturate-150",
      ghost: "border-transparent bg-transparent text-card-foreground",
    },
    depth: {
      0: "shadow-none",
      1: "shadow-sm",
      2: "shadow-md shadow-black/20",
      3: "shadow-lg shadow-black/40",
    },
  },
  defaultVariants: {
    variant: "solid",
    depth: 0,
  },
});

type PanelProps = React.ComponentPropsWithoutRef<"div"> & VariantProps<typeof panelVariants>;

function Panel({ className, variant, depth, ...props }: PanelProps) {
  return <div data-slot="panel" className={cn(panelVariants({ variant, depth }), className)} {...props} />;
}

function PanelHeader({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        "flex h-7 shrink-0 items-center justify-between gap-2 border-b border-inherit px-2 text-2xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function PanelBody({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div data-slot="panel-body" className={cn("flex flex-col gap-1.5 p-2", className)} {...props} />;
}

Panel.Header = PanelHeader;
Panel.Body = PanelBody;

export { Panel, panelVariants };
export type { PanelProps };
