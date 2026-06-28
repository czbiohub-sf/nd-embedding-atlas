import { describe, expect, test } from "bun:test";
import { knifeCrossings, sampleWire, segmentsIntersect, wirePath, type Pt } from "./wire-geometry";

describe("wirePath", () => {
  test("emits M/C bezier with control offset = |x2-x1| * 0.45", () => {
    // |100 - 0| * 0.45 = 45 > 24 → proportional offset.
    expect(wirePath(0, 0, 100, 50)).toBe("M 0 0 C 45 0, 55 50, 100 50");
  });

  test("clamps the control offset to a minimum of 24", () => {
    // |10 - 0| * 0.45 = 4.5 → clamped to 24 (P2.x overshoots left of x2).
    expect(wirePath(0, 0, 10, 50)).toBe("M 0 0 C 24 0, -14 50, 10 50");
  });

  test("right-to-left wires use |x2-x1| (offset stays positive)", () => {
    // |0 - 100| * 0.45 = 45: P1.x = 100 + 45, P2.x = 0 - 45.
    expect(wirePath(100, 20, 0, 80)).toBe("M 100 20 C 145 20, -45 80, 0 80");
  });
});

describe("sampleWire", () => {
  test("returns n+1 points with exact endpoints (default n=20)", () => {
    const pts = sampleWire(3, 7, 103, 57);
    expect(pts).toHaveLength(21);
    expect(pts[0]).toEqual({ x: 3, y: 7 });
    expect(pts[20]).toEqual({ x: 103, y: 57 });
  });

  test("honors a custom sample count", () => {
    const pts = sampleWire(0, 0, 100, 0, 4);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[4]).toEqual({ x: 100, y: 0 });
  });

  test("a horizontal wire (y1 === y2) samples onto that horizontal line", () => {
    // Horizontal tangents + equal endpoint y → every control y is equal.
    // (Bernstein blend sums to 1 only up to floating-point error.)
    const pts = sampleWire(0, 40, 100, 40);
    for (const p of pts) expect(p.y).toBeCloseTo(40, 10);
  });
});

const p = (x: number, y: number): Pt => ({ x, y });

describe("segmentsIntersect", () => {
  test("crossing segments intersect", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true);
  });

  test("non-crossing segments on intersecting lines do not intersect", () => {
    // Lines cross at x=20, but the first segment ends at x=10 (t=2 > 1).
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(20, -5), p(20, 5))).toBe(false);
  });

  test("parallel segments never intersect (zero denominator)", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(0, 5), p(10, 5))).toBe(false);
  });

  test("collinear overlapping segments report no intersection (prototype semantics)", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(15, 0))).toBe(false);
  });

  test("touching at a shared endpoint counts as an intersection (t and u inclusive)", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(10, 0), p(10, 10))).toBe(true);
  });
});

describe("knifeCrossings", () => {
  // Two horizontal wires: "a" along y=0, "b" along y=100. With y1 === y2
  // the sampled bezier stays exactly on that horizontal line.
  const wires = [
    { id: "a", x1: 0, y1: 0, x2: 100, y2: 0 },
    { id: "b", x1: 0, y1: 100, x2: 100, y2: 100 },
  ];

  test("a stroke crossing one of two wires returns only that wire's id", () => {
    const stroke: Pt[] = [
      { x: 50, y: -10 },
      { x: 50, y: 10 },
    ];
    expect(knifeCrossings(stroke, wires)).toEqual(["a"]);
  });

  test("a stroke crossing both wires returns ids in input order", () => {
    const stroke: Pt[] = [
      { x: 50, y: -10 },
      { x: 50, y: 110 },
    ];
    expect(knifeCrossings(stroke, wires)).toEqual(["a", "b"]);
    expect(knifeCrossings(stroke, wires.toReversed())).toEqual(["b", "a"]);
  });

  test("a multi-segment polyline stroke is tested segment by segment", () => {
    // First segment stays above "a"; the second one dives through it.
    const stroke: Pt[] = [
      { x: 10, y: -10 },
      { x: 50, y: -5 },
      { x: 50, y: 10 },
    ];
    expect(knifeCrossings(stroke, wires)).toEqual(["a"]);
  });

  test("a stroke with fewer than 2 points crosses nothing", () => {
    expect(knifeCrossings([], wires)).toEqual([]);
    expect(knifeCrossings([{ x: 50, y: 0 }], wires)).toEqual([]);
  });

  test("a stroke that misses every wire returns an empty list", () => {
    const stroke: Pt[] = [
      { x: 50, y: 40 },
      { x: 50, y: 60 },
    ];
    expect(knifeCrossings(stroke, wires)).toEqual([]);
  });
});
