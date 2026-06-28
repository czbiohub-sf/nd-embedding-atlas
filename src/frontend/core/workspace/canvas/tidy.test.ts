import { describe, expect, test } from "bun:test";
import { tidyLayout, type TidyEdge, type TidyNode } from "./tidy";
import type { Pt } from "./wire-geometry";

const node = (id: string, h = 40): TidyNode => ({ id, w: 200, h });

describe("tidyLayout", () => {
  test("diamond graph layers by longest path: src=0, a/b=1, sink=2", () => {
    const nodes = [node("src"), node("a"), node("b"), node("sink")];
    const edges: TidyEdge[] = [
      { from: "src", to: "a" },
      { from: "src", to: "b" },
      { from: "a", to: "sink" },
      { from: "b", to: "sink" },
    ];
    const out = tidyLayout(nodes, edges, {});

    // Defaults: origin (70, 70), columnPitch 300.
    expect(out["src"]).toEqual({ x: 70, y: 70 });
    expect(out["a"]?.x).toBe(370);
    expect(out["b"]?.x).toBe(370);
    expect(out["sink"]).toEqual({ x: 670, y: 70 });

    // Layer 1 stacks top-down: h(40) + rowGap(46) = 86 pitch.
    expect(out["a"]?.y).toBe(70);
    expect(out["b"]?.y).toBe(156);
  });

  test("longest path wins when a node is reachable at multiple depths", () => {
    // src → mid → sink and src → sink: sink sits at depth 2, not 1.
    const nodes = [node("src"), node("mid"), node("sink")];
    const edges: TidyEdge[] = [
      { from: "src", to: "mid" },
      { from: "mid", to: "sink" },
      { from: "src", to: "sink" },
    ];
    const out = tidyLayout(nodes, edges, {});
    expect(out["sink"]?.x).toBe(70 + 2 * 300);
  });

  test("barycenter ordering follows incoming nodes' placed y positions", () => {
    // Roots order by their CURRENT y: r2 (y=0) stacks above r1 (y=200).
    // Children then order by their parents' NEW y: c2 above c1, even
    // though c1 precedes c2 in the input.
    const nodes = [node("r1"), node("r2"), node("c1"), node("c2")];
    const edges: TidyEdge[] = [
      { from: "r1", to: "c1" },
      { from: "r2", to: "c2" },
    ];
    const positions: Record<string, Pt> = {
      r1: { x: 0, y: 200 },
      r2: { x: 0, y: 0 },
    };
    const out = tidyLayout(nodes, edges, positions);

    expect(out["r2"]?.y).toBe(70);
    expect(out["r1"]?.y).toBe(156);
    expect(out["c2"]?.y).toBe(70);
    expect(out["c1"]?.y).toBe(156);
  });

  test("equal barycenters keep input order (stable sort)", () => {
    // Both children hang off the same parent → identical barycenters.
    const nodes = [node("src"), node("a"), node("b")];
    const edges: TidyEdge[] = [
      { from: "src", to: "a" },
      { from: "src", to: "b" },
    ];
    const out = tidyLayout(nodes, edges, {});
    expect(out["a"]?.y).toBe(70);
    expect(out["b"]?.y).toBe(156);

    const flipped = tidyLayout([node("src"), node("b"), node("a")], edges, {});
    expect(flipped["b"]?.y).toBe(70);
    expect(flipped["a"]?.y).toBe(156);
  });

  test("scope restricts movement and defaults origin to scoped min x/y", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges: TidyEdge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    const positions: Record<string, Pt> = {
      a: { x: 100, y: 50 },
      b: { x: 10, y: 90 },
      c: { x: 500, y: 500 },
    };
    const out = tidyLayout(nodes, edges, positions, { scope: new Set(["a", "b"]) });

    // Only scoped nodes appear in the result — c is untouched.
    expect(Object.keys(out).toSorted()).toEqual(["a", "b"]);

    // Origin = scoped min x/y = (10, 50); b→c is ignored (c unscoped).
    expect(out["a"]).toEqual({ x: 10, y: 50 });
    expect(out["b"]).toEqual({ x: 310, y: 50 });
  });

  test("edges from unscoped nodes do not contribute depth", () => {
    // c → a would push a to depth 1, but c is outside the scope.
    const nodes = [node("a"), node("b"), node("c")];
    const edges: TidyEdge[] = [
      { from: "c", to: "a" },
      { from: "a", to: "b" },
    ];
    const positions: Record<string, Pt> = {
      a: { x: 40, y: 40 },
      b: { x: 80, y: 80 },
      c: { x: 0, y: 0 },
    };
    const out = tidyLayout(nodes, edges, positions, { scope: new Set(["a", "b"]) });
    expect(out["a"]).toEqual({ x: 40, y: 40 });
    expect(out["b"]).toEqual({ x: 340, y: 40 });
  });

  test("explicit origin / columnPitch / rowGap override the defaults", () => {
    const nodes = [node("src", 30), node("a", 30), node("b", 30)];
    const edges: TidyEdge[] = [
      { from: "src", to: "a" },
      { from: "src", to: "b" },
    ];
    const out = tidyLayout(
      nodes,
      edges,
      {},
      {
        origin: { x: 0, y: 10 },
        columnPitch: 100,
        rowGap: 5,
      },
    );
    expect(out["src"]).toEqual({ x: 0, y: 10 });
    expect(out["a"]).toEqual({ x: 100, y: 10 });
    expect(out["b"]).toEqual({ x: 100, y: 45 }); // 10 + 30 + 5
  });

  test("empty node list returns an empty record", () => {
    expect(tidyLayout([], [], {})).toEqual({});
    expect(tidyLayout([node("a")], [], {}, { scope: new Set(["z"]) })).toEqual({});
  });
});
