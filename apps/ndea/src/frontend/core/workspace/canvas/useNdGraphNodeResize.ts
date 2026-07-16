import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import type { NdResizeCorner } from "@/components/nd/nd-resize-grips";
import { ND_NODE } from "../constants";
import { workspaceNodeSize } from "../node-size";
import type { NdGraphNodeModel } from "./useNdGraphNodeModel";

interface ResizeStart {
  x: number;
  y: number;
  w: number;
  h: number;
  px: number;
  py: number;
}

function resizeDimension(
  delta: number,
  start: number,
  minimum: number,
  maximum: number,
  growsForward: boolean,
): number {
  const next = growsForward ? start + delta : start - delta;
  return Math.min(maximum, Math.max(minimum, next));
}

export function useNdGraphNodeResize({ id, ws, form, def }: Pick<NdGraphNodeModel, "id" | "ws" | "form" | "def">) {
  const reactFlow = useReactFlow();
  const removeListenersRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      removeListenersRef.current?.();
    },
    [],
  );

  return useCallback(
    (corner: NdResizeCorner, event: ReactPointerEvent) => {
      if (form === "chip" || !def) return;

      const current = ws.store.state.sizeOverrides[id]?.[form] ?? workspaceNodeSize(def, form);
      const position = ws.store.state.positions[id] ?? { x: 0, y: 0 };
      const start: ResizeStart = {
        x: event.clientX,
        y: event.clientY,
        w: current.w,
        h: current.h,
        px: position.x,
        py: position.y,
      };
      const minimum = ND_NODE.resizeMin[form];

      removeListenersRef.current?.();
      ws.setResizing(id);

      const move = (pointerEvent: PointerEvent) => {
        const zoom = reactFlow.getZoom();
        const dx = (pointerEvent.clientX - start.x) / zoom;
        const dy = (pointerEvent.clientY - start.y) / zoom;
        const w = resizeDimension(dx, start.w, minimum.w, ND_NODE.resizeMax.w, corner.includes("e"));
        const h = resizeDimension(dy, start.h, minimum.h, ND_NODE.resizeMax.h, corner.includes("s"));

        ws.setSizeOverride(id, form, { w, h });
        if (corner.includes("w") || corner.includes("n")) {
          ws.setPosition(id, {
            x: corner.includes("w") ? start.px + (start.w - w) : start.px,
            y: corner.includes("n") ? start.py + (start.h - h) : start.py,
          });
        }
      };
      const stop = () => {
        ws.setResizing(null);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        removeListenersRef.current = null;
      };

      removeListenersRef.current = stop;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
    },
    [def, form, id, reactFlow, ws],
  );
}
