import { describe, expect, test } from "bun:test";
import type { TurntableView, ViewSyncState } from "@ndea/sdk";
import { type Bounds, type Camera, PanZoom2D, transform, Turntable3D } from "./camera";

/** NDC x, y and depth of a world point. */
function ndc(cam: Camera, aspect: number, x: number, y: number, z = 0): [number, number, number] {
  const [cx, cy, cz, w] = transform(cam.viewProj(aspect), x, y, z);
  return [cx / w, cy / w, cz / w];
}

function expectNear(actual: number[], expected: number[]) {
  expected.forEach((e, i) => expect(actual[i]).toBeCloseTo(e, 4));
}

const corners = ({ min, max }: Bounds) =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);

describe("PanZoom2D", () => {
  test("view center projects to the NDC origin and x is divided by the aspect", () => {
    const cam = new PanZoom2D();
    cam.set({ panX: 0.2, panY: -0.1, zoom: 2 });
    expectNear(ndc(cam, 2, -0.2, 0.1), [0, 0]);
    expectNear(ndc(cam, 2, 0.8, 0.1), [1, 0]); // 1 world unit right: zoom 2 / aspect 2
    expectNear(ndc(cam, 2, -0.2, 0.6), [0, 1]);
  });

  test("zoomAt keeps the point under the cursor fixed; drag moves it with the pointer", () => {
    const cam = new PanZoom2D();
    cam.zoomAt(0.5, 0.5, 1, 2);
    cam.settle();
    expect(cam.scale).toBeCloseTo(2);
    expectNear(ndc(cam, 1, 0.5, 0.5), [0.5, 0.5]);
    expectNear(ndc(cam, 1, 0, 0), [-0.5, -0.5]);

    const [x, y] = [0.25, 0.25]; // at NDC (0, 0)
    expectNear(ndc(cam, 1, x, y), [0, 0]);
    cam.drag([0, 0], [0.4, -0.2], 1);
    expectNear(ndc(cam, 1, x, y), [0.4, -0.2]);
  });

  test("fit frames the bounds, centered", () => {
    const cam = new PanZoom2D();
    const bounds: Bounds = { min: [2, 3, 0], max: [4, 7, 0] };
    cam.fit(bounds, 1.5, 100, 0);
    cam.settle();
    expectNear(ndc(cam, 1.5, 3, 5), [0, 0]);
    const extent = Math.max(...corners(bounds).flatMap(([x, y]) => ndc(cam, 1.5, x, y).slice(0, 2).map(Math.abs)));
    expect(extent).toBeLessThanOrEqual(1);
    expect(extent).toBeGreaterThan(0.8);
  });

  test("ignores a 3D view-sync cell", () => {
    const cam = new PanZoom2D();
    const cell: ViewSyncState = { panX: 1, panY: 1, zoom: 3, yaw: 0, pitch: 0, distance: 2, target: [0, 0, 0] };
    expect(cam.set(cell)).toBe(false);
    expect(cam.toViewState()).toEqual({ panX: 0, panY: 0, zoom: 1 });
  });
});

// Looking down −z from +z with the target at (0.5, 0, 0).
const front = (projection: TurntableView["projection"]): ViewSyncState => ({
  panX: 0,
  panY: 0,
  zoom: 1,
  yaw: 0,
  pitch: 0,
  distance: 4,
  target: [0.5, 0, 0],
  projection,
});

describe("Turntable3D", () => {
  for (const projection of ["perspective", "orthographic"] as const) {
    test(`${projection}: target at the center, nearer point has smaller depth`, () => {
      const cam = new Turntable3D();
      expect(cam.set(front(projection))).toBe(true);
      expectNear(ndc(cam, 1, 0.5, 0, 0), [0, 0]);
      const [near, far] = [1, -1].map((z) => ndc(cam, 1, 1.5, 0, z));
      expect(near[2]).toBeLessThan(far[2]);
      expect(near[2]).toBeGreaterThanOrEqual(0);
      expect(far[2]).toBeLessThanOrEqual(1);
      // Perspective shrinks with depth; orthographic does not.
      if (projection === "perspective") expect(near[0]).toBeGreaterThan(far[0]);
      else expect(near[0]).toBeCloseTo(far[0]);
    });
  }

  test("toViewState round-trips through set", () => {
    const a = new Turntable3D();
    const state = { ...front("orthographic"), yaw: 1.1, pitch: -0.4 };
    a.set(state);
    const b = new Turntable3D();
    expect(b.set({ panX: 0, panY: 0, zoom: 1, ...a.toViewState() })).toBe(true);
    expect([...b.viewProj(1.3)]).toEqual([...a.viewProj(1.3)]);
    expect(b.toViewState()).toEqual({
      yaw: 1.1,
      pitch: -0.4,
      distance: 4,
      target: [0.5, 0, 0],
      projection: "orthographic",
    });
  });

  test("ignores a 2D view-sync cell", () => {
    const cam = new Turntable3D();
    const before = cam.toViewState();
    expect(cam.set({ panX: 1, panY: 1, zoom: 3 })).toBe(false);
    expect(cam.toViewState()).toEqual(before);
  });

  test("fit frames the bounds, centered and within depth range", () => {
    const cam = new Turntable3D();
    const bounds: Bounds = { min: [-1, 0, 0.2], max: [0.6, 0.8, 1] };
    cam.fit(bounds, 0.7, 100, 0);
    cam.settle();
    expectNear(ndc(cam, 0.7, -0.2, 0.4, 0.6), [0, 0]);
    for (const [x, y, z] of corners(bounds)) {
      const [px, py, depth] = ndc(cam, 0.7, x, y, z);
      expect(Math.max(Math.abs(px), Math.abs(py))).toBeLessThanOrEqual(1);
      expect(depth).toBeGreaterThanOrEqual(0);
      expect(depth).toBeLessThanOrEqual(1);
    }
  });
});
