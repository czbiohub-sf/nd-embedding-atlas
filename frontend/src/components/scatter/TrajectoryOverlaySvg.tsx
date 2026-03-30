import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { RefObject } from "react";
import type { TrajectoryFrame } from "../../types";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_COLOR = "#22d3ee";
const DEFAULT_ACTIVE_COLOR = "#ffffff";

export interface TrajectoryOverlaySvgHandle {
  /** Called by GPU onViewChange — redraws without React re-render */
  update(): void;
}

/** Minimal GPU interface needed by the trajectory overlay. */
interface WorldToScreenProvider {
  worldToScreen(wx: number, wy: number, w: number, h: number): { x: number; y: number };
}

interface Props {
  points: TrajectoryFrame[];
  activeIndex: number | null;
  categoryColors: string[];
  containerRef: RefObject<HTMLDivElement | null>;
  gpuRef: RefObject<WorldToScreenProvider | null>;
}

export const TrajectoryOverlaySvg = forwardRef<TrajectoryOverlaySvgHandle, Props>(function TrajectoryOverlaySvg(
  { points, activeIndex, categoryColors, containerRef, gpuRef },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });

  // Track container size via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && (r.width !== sizeRef.current.w || r.height !== sizeRef.current.h)) {
        sizeRef.current = { w: r.width, h: r.height };
        setSize({ w: r.width, h: r.height });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [containerRef]);

  function pointColor(point: TrajectoryFrame): string {
    if (categoryColors.length > 0 && point.category != null && point.category < categoryColors.length) {
      return categoryColors[point.category]!;
    }
    return DEFAULT_COLOR;
  }

  // Direct SVG DOM mutation — intentionally non-reactive for GPU pan/zoom performance
  function draw() {
    const svg = svgRef.current;
    const gpu = gpuRef.current;
    const { w, h } = sizeRef.current;
    if (!svg || !gpu || w === 0 || points.length === 0) {
      if (svg) svg.innerHTML = "";
      return;
    }

    const screenPts = points.map((p) => gpu.worldToScreen(p.emb_x, p.emb_y, w, h));

    const g = document.createElementNS(SVG_NS, "g");

    // Line segments between consecutive points
    for (let i = 1; i < points.length; i++) {
      const p1 = screenPts[i - 1]!;
      const p2 = screenPts[i]!;
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(p1.x));
      line.setAttribute("y1", String(p1.y));
      line.setAttribute("x2", String(p2.x));
      line.setAttribute("y2", String(p2.y));
      line.setAttribute("stroke", pointColor(points[i]!));
      line.setAttribute("stroke-width", "2");
      line.setAttribute("stroke-opacity", "0.7");
      g.appendChild(line);
    }

    // Circles at each time point
    for (let i = 0; i < points.length; i++) {
      const pt = screenPts[i]!;
      const isActive = activeIndex != null && i === activeIndex;
      const color = pointColor(points[i]!);
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", String(pt.x));
      circle.setAttribute("cy", String(pt.y));
      circle.setAttribute("r", isActive ? "6" : "3");
      circle.setAttribute("fill", isActive ? DEFAULT_ACTIVE_COLOR : color);
      circle.setAttribute("stroke", isActive ? color : "none");
      circle.setAttribute("stroke-width", isActive ? "2" : "0");
      g.appendChild(circle);
    }

    // Start: diamond marker + End: double-circle (only when >= 2 points)
    if (points.length >= 2) {
      // Diamond at start
      const start = screenPts[0]!;
      const diamond = document.createElementNS(SVG_NS, "rect");
      diamond.setAttribute("x", String(start.x - 4));
      diamond.setAttribute("y", String(start.y - 4));
      diamond.setAttribute("width", "8");
      diamond.setAttribute("height", "8");
      diamond.setAttribute("transform", `rotate(45 ${start.x} ${start.y})`);
      diamond.setAttribute("fill", pointColor(points[0]!));
      diamond.setAttribute("stroke", "#fff");
      diamond.setAttribute("stroke-width", "1");
      g.appendChild(diamond);

      // Double-circle at end
      const end = screenPts[points.length - 1]!;
      const endColor = pointColor(points[points.length - 1]!);
      const outer = document.createElementNS(SVG_NS, "circle");
      outer.setAttribute("cx", String(end.x));
      outer.setAttribute("cy", String(end.y));
      outer.setAttribute("r", "5");
      outer.setAttribute("fill", "none");
      outer.setAttribute("stroke", endColor);
      outer.setAttribute("stroke-width", "2.5");
      g.appendChild(outer);
    }

    svg.innerHTML = "";
    svg.appendChild(g);
  }

  // Expose update() for GPU onViewChange — closure captures latest props via draw()
  useImperativeHandle(ref, () => ({ update: draw }), [points, activeIndex, categoryColors]);

  // Redraw when props or measured size change
  useEffect(() => {
    draw();
  }, [points, activeIndex, categoryColors, size]);

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 pointer-events-none"
      width={size.w}
      height={size.h}
      style={{ overflow: "visible" }}
    />
  );
});
