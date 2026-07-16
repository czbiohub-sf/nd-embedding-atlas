/**
 * NdPort — the 11px typed port glyph. The dot IS the type:
 * pred ● circle · sel ◆ diamond (45° square) · focus ▪ rounded square.
 * Fill encodes direction: filled = out, hollow = in. Frame furniture —
 * absolutely positioned at the edge (−6px), outside the morphing body,
 * so wires stay attached through morphs and resizes.
 */

import type * as React from "react";

/** Typed wire and port kinds. */
export type NdPortKind = "pred" | "sel" | "focus";

export interface NdPortKindSpec {
  /** CSS color — token-backed (app.css --color-wire-*) */
  color: string;
  shape: "circle" | "diamond" | "square";
  label: string;
  /** dataflow model: pred is pulled on demand; sel/focus push on user action */
  flow: "pull" | "push";
}

export const ND_PORT_KINDS: Record<NdPortKind, NdPortKindSpec> = {
  pred: { color: "var(--color-wire-pred)", shape: "circle", label: "predicate", flow: "pull" },
  sel: { color: "var(--color-wire-sel)", shape: "diamond", label: "selection", flow: "push" },
  focus: { color: "var(--color-wire-focus)", shape: "square", label: "focus", flow: "push" },
};

export type NdPortState = "idle" | "legal" | "illegal" | "source";

export interface NdPortProps {
  side: "left" | "right";
  /** center y within the frame (px); default rides the 26px header */
  y?: number;
  kind?: NdPortKind;
  out?: boolean;
  state?: NdPortState;
  onPointerDown?: (e: React.PointerEvent) => void;
  /** drop-target identity: data-port-in="<nodeId>:<portIdx>" */
  nodeId?: string | null;
  portIdx?: number;
}

const LEGAL_RING = "0 0 0 2.5px oklch(0.69 0.19 170 / 55%), 0 0 10px oklch(0.69 0.19 170 / 45%)";

export function NdPort({
  side,
  y = 13,
  kind = "pred",
  out = false,
  state = "idle",
  onPointerDown,
  nodeId = null,
  portIdx = 1,
}: NdPortProps) {
  const spec = ND_PORT_KINDS[kind];
  const shape: React.CSSProperties =
    spec.shape === "diamond"
      ? { borderRadius: 2, transform: "rotate(45deg)" }
      : spec.shape === "square"
        ? { borderRadius: 2.5 }
        : { borderRadius: 999 };
  const ring =
    state === "legal"
      ? LEGAL_RING
      : state === "source"
        ? `0 0 0 2.5px color-mix(in oklab, ${spec.color} 33%, transparent)`
        : "none";
  return (
    <span
      data-port={kind}
      data-port-in={!out && nodeId ? `${nodeId}:${portIdx}` : undefined}
      onPointerDown={onPointerDown}
      title={`${spec.label} ${out ? "out" : "in"}`}
      className="absolute z-[8] box-border size-[11px]"
      style={{
        top: y - 5.5,
        [side]: -6,
        cursor: out && onPointerDown ? "crosshair" : "default",
        background: out ? spec.color : "var(--card)",
        border: `1.5px solid ${spec.color}`,
        boxShadow: ring,
        opacity: state === "illegal" ? 0.3 : state === "source" ? undefined : 1,
        ...shape,
      }}
    />
  );
}
