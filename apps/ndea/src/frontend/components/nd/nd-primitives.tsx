/**
 * nd telemetry atoms: NdLed, NdHud, NdKv, NdCaption (+ NdChip alias).
 *
 * The workspace talks like lab-equipment telemetry: lowercase mono labels,
 * bracketed counts, LED cook states. Counts reuse the existing `Bracketed`;
 * chips reuse `DimensionBadge` (vocabulary alias: NdChip).
 */

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

export { Bracketed as NdBracketed } from "@/components/ui/bracketed";
export { DimensionBadge as NdChip } from "@/components/ui/dimension-badge";

/* ── Status LED: the cook lifecycle ─────────────────────────────── */

const ndLedVariants = cva("inline-block shrink-0 rounded-full", {
  variants: {
    state: {
      clean: "bg-success shadow-[0_0_5px] shadow-success/60",
      dirty: "bg-warning shadow-[0_0_5px] shadow-warning/60",
      cooking: "animate-nd-led-pulse bg-primary shadow-[0_0_6px] shadow-primary/80",
      idle: "bg-text-muted opacity-45 shadow-none",
      error: "bg-destructive shadow-[0_0_5px] shadow-destructive/60",
    },
  },
  defaultVariants: { state: "clean" },
});

export type NdLedState = NonNullable<VariantProps<typeof ndLedVariants>["state"]>;

export function NdLed({
  state = "clean",
  size = 6,
  className,
}: {
  state?: NdLedState;
  size?: number;
  className?: string;
}) {
  return <span className={cn(ndLedVariants({ state }), className)} style={{ width: size, height: size }} />;
}

/* ── HUD label: Geist Pixel signage, uppercase ──────────────────── */

export function NdHud({
  children,
  size = 11,
  className,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={cn("font-hud uppercase tracking-[0.02em] text-text-muted", className)}
      style={{ fontSize: size, ...style }}
    >
      {children}
    </span>
  );
}

/* ── Telemetry key/value ─────────────────────────────────────────── */

export function NdKv({ k, v, className }: { k: string; v: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex gap-1 font-mono text-3xs tabular-nums text-text-muted", className)}>
      <span className="opacity-70">{k}</span>
      <span className="text-muted-foreground">{v}</span>
    </span>
  );
}

/* ── Muted caption: in-surface commentary ───────────────────────── */

export function NdCaption({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("font-sans text-[10.5px] leading-normal text-text-muted", className)}>{children}</div>;
}
