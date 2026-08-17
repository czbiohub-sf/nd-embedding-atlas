/**
 * NdWireEdge: the typed wire. Geometry from wire-geometry (horizontal
 * tangents, ctrl offset max(|dx|·0.45, 24)); styling by port kind:
 *   pred : solid periwinkle; cooking = dash 7 7 flowing; dirty source = amber 50%
 *   sel  : amber dash 2 10, round caps, pushing
 *   focus: sky dash 1 6, pushing
 * Click selects (11px invisible hit path via interactionWidth); a ✕ chip at
 * the midpoint disconnects.
 */

import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";

import { ND_PORT_KINDS, type NdPortKind } from "@/components/node-workspace/nd-port";
import { wirePath } from "./wire-geometry";
import { useTelemetrySelector, useWorkspace } from "../workspace-context";

export interface NdWireEdgeData {
  kind: NdPortKind;
  [key: string]: unknown;
}
export type NdWireEdgeType = Edge<NdWireEdgeData, "ndwire">;

function NdWireEdgeInner({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps<NdWireEdgeType>) {
  const ws = useWorkspace();
  const kind = data?.kind ?? "pred";
  const spec = ND_PORT_KINDS[kind];

  const telemetryOn = useTelemetrySelector((t) => t.enabled);
  const targetCooking = useTelemetrySelector((t) => t.cooking[target] ?? false);
  const sourceDirty = useTelemetrySelector((t) => t.dirty[source] ?? false);

  const path = wirePath(sourceX, sourceY, targetX, targetY);

  let stroke = spec.color;
  let strokeWidth = 1.4;
  let dash: string | undefined;
  let animClass = "";
  if (kind === "pred") {
    const cooking = telemetryOn && targetCooking;
    if (sourceDirty && telemetryOn) stroke = "color-mix(in oklab, var(--color-wire-sel) 50%, transparent)";
    else stroke = cooking ? "var(--color-wire-pred)" : "color-mix(in oklab, var(--color-wire-pred) 65%, transparent)";
    if (cooking) {
      dash = "7 7";
      animClass = "animate-nd-wire-flow";
      strokeWidth = 1.7;
    }
  } else if (kind === "sel") {
    dash = "2 10";
    animClass = telemetryOn ? "animate-nd-wire-push" : "";
    strokeWidth = 1.7;
  } else {
    dash = "1 6";
    animClass = telemetryOn ? "animate-nd-wire-push" : "";
    strokeWidth = 1.5;
  }

  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={animClass}
        interactionWidth={11}
        style={{
          stroke,
          strokeWidth: selected ? 2.6 : strokeWidth,
          strokeDasharray: dash,
          strokeLinecap: kind === "sel" || kind === "focus" ? "round" : undefined,
          filter: selected ? "drop-shadow(0 0 4px oklch(from var(--color-wire-pred) l c h / 80%))" : undefined,
        }}
      />
      {selected ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            title="disconnect"
            className="nodrag nopan pointer-events-auto absolute z-[9] size-[18px] cursor-pointer rounded-full border border-destructive/70 bg-card p-0 text-[10px] leading-none text-destructive"
            style={{ transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)` }}
            onClick={(e) => {
              e.stopPropagation();
              ws.deleteEdge(id);
            }}
          >
            ✕
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const NdWireEdge = memo(NdWireEdgeInner);
