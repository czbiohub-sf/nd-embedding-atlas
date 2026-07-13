/**
 * Pure wire geometry for the node-workspace canvas.
 *
 * Ported from the design prototype (`proto-canvas.jsx` — `segInt`,
 * `sampleEdge`, `knifeCrossed`; `helpers.jsx` — `ndWire`). No React, no DOM.
 *
 * A "wire" is a cubic bezier with horizontal tangents at both ends:
 *   P0 = (x1, y1)
 *   P1 = (x1 + o, y1)
 *   P2 = (x2 - o, y2)
 *   P3 = (x2, y2)
 * with control offset o = max(|x2 - x1| * 0.45, 24).
 */

export interface Pt {
  x: number;
  y: number;
}

/** Control-point offset for the wire bezier. */
function controlOffset(x1: number, x2: number): number {
  return Math.max(Math.abs(x2 - x1) * 0.45, 24);
}

/**
 * SVG path for a typed wire: cubic bezier, horizontal tangents,
 * control offset = max(|x2-x1| * 0.45, 24).
 */
export function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const o = controlOffset(x1, x2);
  return `M ${x1} ${y1} C ${x1 + o} ${y1}, ${x2 - o} ${y2}, ${x2} ${y2}`;
}

/** Sample the same bezier into n+1 points (default n=20) for hit tests. */
export function sampleWire(x1: number, y1: number, x2: number, y2: number, n = 20): Pt[] {
  const o = controlOffset(x1, x2);
  const p0x = x1;
  const p0y = y1;
  const p1x = x1 + o;
  const p1y = y1;
  const p2x = x2 - o;
  const p2y = y2;
  const p3x = x2;
  const p3y = y2;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    pts.push({
      x: mt * mt * mt * p0x + 3 * mt * mt * t * p1x + 3 * mt * t * t * p2x + t * t * t * p3x,
      y: mt * mt * mt * p0y + 3 * mt * mt * t * p1y + 3 * mt * t * t * p2y + t * t * t * p3y,
    });
  }
  return pts;
}

/**
 * Segment-segment intersection test (segments a→b and c→d).
 *
 * Parallel / collinear segments report no intersection (denominator 0),
 * matching the prototype's knife semantics.
 */
export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (!den) return false;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Endpoint description of a wire for knife hit-testing. */
export interface WireEndpoints {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Which wires does a knife stroke (polyline) cross?
 * Returns the crossed wire ids in input order.
 */
export function knifeCrossings(stroke: Pt[], wires: WireEndpoints[]): string[] {
  if (stroke.length < 2) return [];
  const out: string[] = [];
  for (const w of wires) {
    const ep = sampleWire(w.x1, w.y1, w.x2, w.y2);
    let hit = false;
    for (let i = 1; i < stroke.length && !hit; i++) {
      for (let j = 1; j < ep.length && !hit; j++) {
        if (segmentsIntersect(stroke[i - 1], stroke[i], ep[j - 1], ep[j])) hit = true;
      }
    }
    if (hit) out.push(w.id);
  }
  return out;
}
