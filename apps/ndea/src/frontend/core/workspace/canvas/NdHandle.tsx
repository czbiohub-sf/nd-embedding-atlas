/**
 * NdHandle: an xyflow Handle wearing the NdPort glyph. The dot IS the
 * type: pred ● / sel ◆ / focus ▪; filled = out, hollow = in. Legality glow
 * during a live wire drag comes from useConnection + the workspace rule
 * (kind-compat + no-dup + DAG).
 */

import { Handle, Position, useConnection } from "@xyflow/react";
import type * as React from "react";

import { ND_PORT_KINDS, type NdPortKind } from "@/components/node-workspace/nd-port";
import { useWorkspace } from "../workspace-context";

/** Ring on a handle the in-flight wire may land on; see --shadow-legal-ring. */
const LEGAL_RING = "var(--shadow-legal-ring)";

interface NdHandleProps {
  readonly nodeId: string;
  readonly portId?: string;
  readonly kind: NdPortKind;
  readonly out: boolean;
  readonly top?: number;
}

export function NdHandle({ nodeId, portId, kind, out, top = 13 }: NdHandleProps): React.ReactElement {
  const ws = useWorkspace();
  const spec = ND_PORT_KINDS[kind];
  const conn = useConnection();

  let ring = "none";
  let opacity = 1;
  if (conn.inProgress && conn.fromNode) {
    if (!out) {
      if (ws.canConnectWire(conn.fromNode.id, nodeId, conn.fromHandle?.id, portId)) ring = LEGAL_RING;
      else opacity = 0.3;
    } else if (conn.fromNode.id === nodeId) {
      ring = `0 0 0 2.5px color-mix(in oklab, ${spec.color} 33%, transparent)`;
    }
  }

  const shape: React.CSSProperties =
    spec.shape === "diamond"
      ? { borderRadius: 2, transform: "translateY(-50%) rotate(45deg)" }
      : spec.shape === "square"
        ? { borderRadius: 2.5 }
        : { borderRadius: 999 };

  return (
    <Handle
      type={out ? "source" : "target"}
      position={out ? Position.Right : Position.Left}
      id={portId ?? (out ? "out" : "in")}
      title={`${spec.label} ${out ? "out" : "in"}`}
      style={{
        width: 11,
        height: 11,
        boxSizing: "border-box",
        top,
        [out ? "right" : "left"]: -6,
        background: out ? spec.color : "var(--card)",
        border: `1.5px solid ${spec.color}`,
        boxShadow: ring,
        opacity,
        zIndex: 8,
        minWidth: 0,
        minHeight: 0,
        ...shape,
      }}
    />
  );
}
