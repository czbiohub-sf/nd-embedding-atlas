/**
 * NdPort: the 11px predicate port glyph (● circle). Fill encodes direction:
 * filled = out, hollow = in. Frame furniture: absolutely positioned at the
 * edge (−6px), outside the morphing body, so wires stay attached through
 * morphs and resizes.
 */

import type { PortKind } from "@ndea/sdk";
import type * as React from "react";

/** Typed wire and port kinds. */
export type NdPortKind = PortKind;

export interface NdPortKindSpec {
  /** CSS color: token-backed (app.css --color-wire-*) */
  color: string;
  label: string;
}

export const ND_PORT_KINDS: Record<NdPortKind, NdPortKindSpec> = {
  pred: { color: "var(--color-wire-pred)", label: "predicate" },
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

/** Ring on a port the in-flight wire may land on; see --shadow-legal-ring. */
const LEGAL_RING = "var(--shadow-legal-ring)";

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
        borderRadius: 999,
      }}
    />
  );
}
