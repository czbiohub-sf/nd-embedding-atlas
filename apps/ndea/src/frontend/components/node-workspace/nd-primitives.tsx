/**
 * nd telemetry atoms: NdLed, NdHud, NdCaption.
 *
 * The workspace talks like lab-equipment telemetry: lowercase mono labels and
 * LED states.
 */

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@ndea/ui/lib/utils";

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

/* ── Muted caption: in-surface commentary ───────────────────────── */

export function NdCaption({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("font-sans text-[10.5px] leading-normal text-text-muted", className)}>{children}</div>;
}
