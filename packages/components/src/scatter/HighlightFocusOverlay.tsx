import type { RefObject } from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { WIRE_FOCUS_COLOR } from "./helpers";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Used only if the page background token cannot be read (no computed style). */
const SCRIM_FALLBACK = "#0a0a0a";
/** The "single-record focus" channel color; shared with --color-wire-focus. */
const FOCUS_COLOR = WIRE_FOCUS_COLOR;

export interface HighlightFocusOverlayHandle {
  /** Redraw without a React re-render: called from GPU onViewChange. */
  update(): void;
}

/** Minimal GPU interface needed to place the marker. */
interface WorldToScreenProvider {
  worldToScreen(wx: number, wy: number, w: number, h: number): { x: number; y: number };
}

interface Props {
  /** Normalized [-1,1] world position of the focused point, or null when none. */
  worldPos: readonly [number, number] | null;
  containerRef: RefObject<HTMLDivElement | null>;
  gpuRef: RefObject<WorldToScreenProvider | null>;
}

/**
 * Single-point focus affordance: dim the whole scatter and mark ONLY the clicked
 * point with a bright dot + ring. A spatial cutout would reveal every neighbor
 * that fell inside it (wrong in a dense region); a single marker isolates exactly
 * one point. The focus signal lives in this SVG overlay (not the GPU highlight
 * buffer, which stays for trajectories): a lone GPU-bright point is invisible
 * under additive blending.
 * Mirrors TrajectoryOverlaySvg: direct DOM mutation, redrawn on pan/zoom via the
 * imperative `update()` so camera moves don't trigger React re-renders.
 */
export const HighlightFocusOverlay = forwardRef<HighlightFocusOverlayHandle, Props>(function HighlightFocusOverlay(
  { worldPos, containerRef, gpuRef },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return () => {};
    const obs = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && (r.width !== sizeRef.current.w || r.height !== sizeRef.current.h)) {
        sizeRef.current = { w: r.width, h: r.height };
        setSize({ w: r.width, h: r.height });
      }
    });
    obs.observe(el);
    return () => {
      obs.disconnect();
    };
  }, [containerRef]);

  function draw() {
    const svg = svgRef.current;
    const gpu = gpuRef.current;
    const { w, h } = sizeRef.current;
    if (!svg || !gpu || w === 0 || !worldPos) {
      if (svg) svg.innerHTML = "";
      return;
    }
    const { x, y } = gpu.worldToScreen(worldPos[0], worldPos[1], w, h);
    // Resolve the dim to a literal: CSS var() does NOT resolve inside an SVG
    // presentation attribute (only its computed value does), so read the page
    // background. `--color-base` was read here before and never existed, so this
    // silently always used the hardcoded fallback.
    const dim = getComputedStyle(document.documentElement).getPropertyValue("--background").trim() || SCRIM_FALLBACK;
    const g = document.createElementNS(SVG_NS, "g");

    // Dim the WHOLE scatter: neighbors of the clicked point included: then mark
    // ONLY the clicked point. A circular cutout would reveal every neighbor that
    // fell inside it (wrong in a dense region); one marker isolates exactly one.
    const scrim = document.createElementNS(SVG_NS, "rect");
    scrim.setAttribute("x", "0");
    scrim.setAttribute("y", "0");
    scrim.setAttribute("width", String(w));
    scrim.setAttribute("height", String(h));
    scrim.setAttribute("fill", dim);
    scrim.setAttribute("fill-opacity", "0.72");
    g.appendChild(scrim);

    // Ring draws the eye to the focused point.
    const ring = document.createElementNS(SVG_NS, "circle");
    ring.setAttribute("cx", String(x));
    ring.setAttribute("cy", String(y));
    ring.setAttribute("r", "12");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", FOCUS_COLOR);
    ring.setAttribute("stroke-width", "2");
    ring.setAttribute("stroke-opacity", "0.95");
    g.appendChild(ring);

    // The marker IS the spotlighted point: a single bright dot at the click, so
    // exactly one point reads as selected no matter how dense the region.
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    dot.setAttribute("r", "4.5");
    dot.setAttribute("fill", FOCUS_COLOR);
    g.appendChild(dot);

    svg.innerHTML = "";
    svg.appendChild(g);
  }

  // Expose update() for GPU onViewChange: closure captures latest props via draw().
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({ update: draw }), [draw]);

  // Redraw when the focused point or measured size changes.
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw]);

  return (
    <svg
      ref={svgRef}
      className="pointer-events-none absolute inset-0"
      width={size.w}
      height={size.h}
      style={{ overflow: "visible" }}
    />
  );
});
