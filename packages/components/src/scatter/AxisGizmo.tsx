/**
 * The corner x/y/z gizmo of a 3D embedding: each data axis as the camera sees
 * it, so an orbit always shows which way x, y, and z point. Redrawn by direct
 * DOM writes from the view callbacks, like the focus overlay, so camera moves
 * never re-render React.
 */

import type { PanZoomView, TurntableView, ViewSyncState } from "@ndea/sdk";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { basis } from "./gpu/gpu/camera";

const AXES = ["x", "y", "z"] as const;
/** The usual 3D axis colors (x red, y green, z blue), mid-tone so they read on dark and light surfaces. */
const AXIS_COLOR = { x: "#f0524f", y: "#3fb86b", z: "#4a8ef0" } as const;
/** Half the gizmo's box, and the screen length of an axis that faces the viewer side-on. */
const HALF = 36;
const LENGTH = 22;

export interface AxisGizmoHandle {
  /** Point the axes for a view; a 2D view (no yaw/pitch) is ignored. */
  update(view: PanZoomView | TurntableView | ViewSyncState): void;
}

export const AxisGizmo = forwardRef<AxisGizmoHandle>(function AxisGizmo(_, ref) {
  const lines = useRef<(SVGLineElement | null)[]>([]);
  const labels = useRef<(SVGTextElement | null)[]>([]);

  useImperativeHandle(
    ref,
    () => ({
      update(view) {
        if (!("yaw" in view) || view.yaw === undefined || view.pitch === undefined) return;
        const { yaw, pitch } = view;
        const [right, up, back] = basis({ yaw, pitch });
        for (let i = 0; i < AXES.length; i++) {
          const x = right[i] * LENGTH;
          const y = -up[i] * LENGTH;
          // An axis pointing away from the viewer reads dimmer.
          const opacity = back[i] < -0.2 ? "0.45" : "1";
          const line = lines.current[i];
          line?.setAttribute("x2", String(x));
          line?.setAttribute("y2", String(y));
          line?.setAttribute("opacity", opacity);
          const label = labels.current[i];
          // Labels sit past the tip, nudged out so a foreshortened axis keeps its letter readable.
          const len = Math.hypot(x, y) || 1;
          label?.setAttribute("x", String(x + (x / len) * 7));
          label?.setAttribute("y", String(y + (y / len) * 7));
          label?.setAttribute("opacity", opacity);
        }
      },
    }),
    [],
  );

  return (
    <svg
      aria-hidden
      width={HALF * 2}
      height={HALF * 2}
      viewBox={`${-HALF} ${-HALF} ${HALF * 2} ${HALF * 2}`}
      className="pointer-events-none absolute top-2 right-2 z-10"
    >
      {AXES.map((axis, i) => (
        <g key={axis}>
          <line
            ref={(el) => {
              lines.current[i] = el;
            }}
            x1={0}
            y1={0}
            x2={0}
            y2={0}
            stroke={AXIS_COLOR[axis]}
            strokeWidth={1.75}
            strokeLinecap="round"
          />
          <text
            ref={(el) => {
              labels.current[i] = el;
            }}
            fill={AXIS_COLOR[axis]}
            fontSize={12}
            className="font-mono"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {axis}
          </text>
        </g>
      ))}
    </svg>
  );
});
