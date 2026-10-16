/**
 * nd telemetry atoms: NdHud, NdCaption.
 *
 * The workspace talks like lab-equipment telemetry: lowercase mono labels.
 */

import type * as React from "react";

import { cn } from "@ndea/ui/lib/utils";

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
