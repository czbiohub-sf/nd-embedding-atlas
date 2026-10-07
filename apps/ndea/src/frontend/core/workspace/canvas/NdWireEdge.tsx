/**
 * NdWireEdge: the predicate wire. Geometry from wire-geometry (horizontal
 * tangents, ctrl offset max(|dx|·0.45, 24)); solid periwinkle, cooking =
 * dash 7 7 flowing, dirty source = amber 50%. Click selects (11px invisible
 * hit path via interactionWidth); a ✕ chip at the midpoint disconnects.
 */

import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";

import { wirePath } from "./wire-geometry";
import { useTelemetrySelector, useWorkspace } from "../workspace-context";

export type NdWireEdgeType = Edge<Record<string, unknown>, "ndwire">;

function NdWireEdgeInner({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
}: EdgeProps<NdWireEdgeType>) {
  const ws = useWorkspace();

  const telemetryOn = useTelemetrySelector((t) => t.enabled);
  const targetCooking = useTelemetrySelector((t) => t.cooking[target] ?? false);
  const sourceDirty = useTelemetrySelector((t) => t.dirty[source] ?? false);

  const path = wirePath(sourceX, sourceY, targetX, targetY);

  const cooking = telemetryOn && targetCooking;
  let stroke = cooking ? "var(--color-wire-pred)" : "color-mix(in oklab, var(--color-wire-pred) 65%, transparent)";
  if (sourceDirty && telemetryOn) stroke = "color-mix(in oklab, var(--color-wire-sel) 50%, transparent)";
  const strokeWidth = cooking ? 1.7 : 1.4;
  const dash = cooking ? "7 7" : undefined;
  const animClass = cooking ? "animate-nd-wire-flow" : "";

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
