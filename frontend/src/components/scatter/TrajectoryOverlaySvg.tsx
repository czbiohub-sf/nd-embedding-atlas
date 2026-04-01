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
  /** Raw → normalized coordinate divisor (from backend positionScale). Default 1. */
  positionScale?: number;
}

export const TrajectoryOverlaySvg = forwardRef<TrajectoryOverlaySvgHandle, Props>(function TrajectoryOverlaySvg(
  { points, activeIndex, categoryColors, containerRef, gpuRef, positionScale = 1 },
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

    const s = positionScale > 0 ? positionScale : 1;
    const screenPts = points.map((p) => gpu.worldToScreen(p.emb_x / s, p.emb_y / s, w, h));

    // Arrowhead marker — one per distinct color, keyed by color string
    const defs = document.createElementNS(SVG_NS, "defs");
    const markerColors = new Set(points.map((p) => pointColor(p)));
    for (const color of markerColors) {
      const markerId = `traj-arrow-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
      const marker = document.createElementNS(SVG_NS, "marker");
      marker.setAttribute("id", markerId);
      marker.setAttribute("markerWidth", "6");
      marker.setAttribute("markerHeight", "6");
      marker.setAttribute("refX", "5");
      marker.setAttribute("refY", "3");
      marker.setAttribute("orient", "auto");
      const arrow = document.createElementNS(SVG_NS, "path");
      arrow.setAttribute("d", "M0,0 L0,6 L6,3 z");
      arrow.setAttribute("fill", color);
      arrow.setAttribute("fill-opacity", "0.8");
      marker.appendChild(arrow);
      defs.appendChild(marker);
    }

    const g = document.createElementNS(SVG_NS, "g");
    g.appendChild(defs);

    // Line segments with directional arrowheads
    for (let i = 1; i < points.length; i++) {
      const p1 = screenPts[i - 1]!;
      const p2 = screenPts[i]!;
      const color = pointColor(points[i]!);
      const markerId = `traj-arrow-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
      // Shorten line end slightly so arrowhead sits at the point
      const dx = p2.x - p1.x,
        dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const shorten = len > 0 ? 8 / len : 0;
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(p1.x));
      line.setAttribute("y1", String(p1.y));
      line.setAttribute("x2", String(p2.x - dx * shorten));
      line.setAttribute("y2", String(p2.y - dy * shorten));
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "2");
      line.setAttribute("stroke-opacity", "0.7");
      line.setAttribute("marker-end", `url(#${markerId})`);
      g.appendChild(line);
    }

    // Circles at each time point — all fully opaque, active gets a pulse ring
    for (let i = 0; i < points.length; i++) {
      const pt = screenPts[i]!;
      const isActive = activeIndex != null && i === activeIndex;
      const color = pointColor(points[i]!);

      if (isActive) {
        // Pulsing outer ring via SVG animate
        const ring = document.createElementNS(SVG_NS, "circle");
        ring.setAttribute("cx", String(pt.x));
        ring.setAttribute("cy", String(pt.y));
        ring.setAttribute("r", "8");
        ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", color);
        ring.setAttribute("stroke-width", "1.5");
        ring.setAttribute("stroke-opacity", "0.6");
        const animR = document.createElementNS(SVG_NS, "animate");
        animR.setAttribute("attributeName", "r");
        animR.setAttribute("values", "7;13;7");
        animR.setAttribute("dur", "1.6s");
        animR.setAttribute("repeatCount", "indefinite");
        const animO = document.createElementNS(SVG_NS, "animate");
        animO.setAttribute("attributeName", "stroke-opacity");
        animO.setAttribute("values", "0.6;0;0.6");
        animO.setAttribute("dur", "1.6s");
        animO.setAttribute("repeatCount", "indefinite");
        ring.appendChild(animR);
        ring.appendChild(animO);
        g.appendChild(ring);
      }

      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", String(pt.x));
      circle.setAttribute("cy", String(pt.y));
      circle.setAttribute("r", isActive ? "5.5" : "3.5");
      circle.setAttribute("fill", isActive ? DEFAULT_ACTIVE_COLOR : color);
      circle.setAttribute("stroke", color);
      circle.setAttribute("stroke-width", isActive ? "2" : "1");
      circle.setAttribute("stroke-opacity", "0.9");
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
  useImperativeHandle(ref, () => ({ update: draw }), [points, activeIndex, categoryColors, positionScale]);

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
