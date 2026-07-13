/**
 * NdResizeGrips — four corner hotspots for card/full frames (chips are
 * canonical and never resized). Only the SE corner carries a visible ◢
 * glyph; all four are 14px hit areas with directional cursors. The host
 * owns the drag (per-form bodySize overrides, opposite-corner anchoring).
 */

import type * as React from "react";

export type NdResizeCorner = "nw" | "ne" | "sw" | "se";

const CORNERS: [NdResizeCorner, string][] = [
  ["nw", "nwse"],
  ["ne", "nesw"],
  ["sw", "nesw"],
  ["se", "nwse"],
];

export function NdResizeGrips({ onResize }: { onResize: (corner: NdResizeCorner, e: React.PointerEvent) => void }) {
  return (
    <>
      {CORNERS.map(([corner, cur]) => (
        <span
          key={corner}
          data-nodrag="1"
          title="resize"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResize(corner, e);
          }}
          // `nodrag` is xyflow's noDragClassName — its d3 drag listens
          // natively on the node wrapper, so React stopPropagation alone
          // can't keep a grip drag from also dragging the node
          className="nodrag absolute z-[9] grid size-[14px] place-items-center"
          style={{
            [corner.includes("n") ? "top" : "bottom"]: -2,
            [corner.includes("w") ? "left" : "right"]: -2,
            cursor: `${cur}-resize`,
          }}
        >
          {corner === "se" ? (
            <svg width="10" height="10" className="mt-0.5 ml-0.5 block opacity-55">
              <path d="M9 3 L3 9 M9 7 L7 9" stroke="var(--color-text-muted)" strokeWidth="1.4" fill="none" />
            </svg>
          ) : null}
        </span>
      ))}
    </>
  );
}
