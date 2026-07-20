/**
 * Sugiyama-lite auto-layout for the node-workspace canvas.
 *
 * Ported from the design prototype (`proto-app.jsx`: `tidy()`). Pure module:
 * no React, no DOM.
 *
 * Algorithm:
 *   1. Longest-path layering from in-degree-0 roots
 *      (depth = max(parent depths) + 1).
 *   2. Within each layer, order by barycenter of incoming nodes'
 *      (new, else current) y positions; roots fall back to current y.
 *   3. Place layer d at x = origin.x + d * columnPitch; stack nodes top-down
 *      from origin.y with y += node.h + rowGap.
 *
 * When `scope` is set, only scoped nodes move (edges touching unscoped nodes
 * are ignored) and the origin defaults to the scoped nodes' min x/y.
 */

import type { Pt } from "./wire-geometry";

export interface TidyNode {
  id: string;
  w: number;
  h: number;
}

export interface TidyEdge {
  from: string;
  to: string;
}

export interface TidyOptions {
  /** Top-left corner of the layout. Default {x: 70, y: 70}. */
  origin?: Pt;
  /** Horizontal distance between layer columns. Default 300. */
  columnPitch?: number;
  /** Vertical gap between stacked nodes in a column. Default 46. */
  rowGap?: number;
  /** Restrict layout to a subset of nodes; edges outside the scope are ignored. */
  scope?: ReadonlySet<string>;
}

/**
 * Compute tidy positions for `nodes` (or the `scope` subset).
 * Returns ONLY the moved nodes' new positions.
 */
export function tidyLayout(
  nodes: TidyNode[],
  edges: TidyEdge[],
  positions: Record<string, Pt>,
  opts: TidyOptions = {},
): Record<string, Pt> {
  const scope = opts.scope;
  const scoped = scope ? nodes.filter((n) => scope.has(n.id)) : nodes;
  if (!scoped.length) return {};

  const ids = new Set(scoped.map((n) => n.id));
  const byId = new Map(scoped.map((n) => [n.id, n]));

  // Incoming adjacency, restricted to in-scope endpoints on both sides.
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const ins = incoming.get(e.to);
    if (ins) ins.push(e.from);
    else incoming.set(e.to, [e.from]);
  }

  // Origin: explicit option wins; a scoped layout defaults to the scoped
  // nodes' current min x/y; otherwise the canvas default (70, 70).
  let x0 = opts.origin?.x ?? 70;
  let y0 = opts.origin?.y ?? 70;
  if (scope && !opts.origin) {
    x0 = Math.min(...scoped.map((n) => positions[n.id]?.x ?? 70));
    y0 = Math.min(...scoped.map((n) => positions[n.id]?.y ?? 70));
  }
  const columnPitch = opts.columnPitch ?? 300;
  const rowGap = opts.rowGap ?? 46;

  // Longest-path layering: depth = max(parent depths) + 1, roots at 0.
  const depth = new Map<string, number>();
  const calc = (id: string): number => {
    const cached = depth.get(id);
    if (cached != null) return cached;
    // Provisional 0 guards against cycles (never read back on a DAG).
    depth.set(id, 0);
    const ins = incoming.get(id);
    const d = ins?.length ? Math.max(...ins.map(calc)) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  for (const n of scoped) calc(n.id);

  // Bucket into layers, preserving input order within each layer.
  const layers = new Map<number, string[]>();
  for (const n of scoped) {
    const d = depth.get(n.id) ?? 0;
    const layer = layers.get(d);
    if (layer) layer.push(n.id);
    else layers.set(d, [n.id]);
  }

  const newPos: Record<string, Pt> = {};
  const sortedDepths = [...layers.keys()].toSorted((a, b) => a - b);
  for (const d of sortedDepths) {
    const layer = layers.get(d) ?? [];
    // Barycenter of incoming nodes' (new, else current) y; roots fall
    // back to their current y. Longest-path layering admits no same-layer
    // edges, so every parent is already placed: precomputing is safe.
    const bary = new Map<string, number>();
    for (const id of layer) {
      const ins = incoming.get(id);
      if (!ins?.length) {
        bary.set(id, positions[id]?.y ?? 0);
        continue;
      }
      let sum = 0;
      for (const f of ins) sum += newPos[f]?.y ?? positions[f]?.y ?? 0;
      bary.set(id, sum / ins.length);
    }
    // Array.prototype.sort is stable: equal barycenters keep input order.
    layer.sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0));
    let y = y0;
    for (const id of layer) {
      newPos[id] = { x: x0 + d * columnPitch, y };
      y += (byId.get(id)?.h ?? 0) + rowGap;
    }
  }
  return newPos;
}
