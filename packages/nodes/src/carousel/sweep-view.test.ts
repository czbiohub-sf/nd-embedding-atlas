import { describe, expect, test } from "bun:test";

import { fullView, sameView, type ViewBounds, viewToWorldFrame, worldRectToView } from "./sweep-view";

/** Two FOVs of identical size at DIFFERENT plate positions — the whole problem. */
const fovA: ViewBounds = { translation: { x: 0, y: 0 }, size: { width: 2048, height: 2048 } };
const fovB: ViewBounds = { translation: { x: 10_000, y: 4_000 }, size: { width: 2048, height: 2048 } };

function rectOf(frame: { left: number; right: number; bottom: number; top: number }) {
  return {
    x: frame.left,
    y: frame.bottom,
    width: frame.right - frame.left,
    height: frame.top - frame.bottom,
  };
}

describe("sweep shared view", () => {
  test("fullView frames exactly the whole FOV", () => {
    expect(viewToWorldFrame(fovA, fullView(fovA))).toEqual({ left: 0, right: 2048, bottom: 0, top: 2048 });
  });

  test("the same shared view lands on each FOV's own plate position", () => {
    // The reason sync is normalized: a raw world-space copy would aim slide B at
    // slide A's coordinates and render empty space.
    const view = fullView(fovA);
    const a = viewToWorldFrame(fovA, view);
    const b = viewToWorldFrame(fovB, view);

    expect(b.left).toBe(10_000);
    expect(b.bottom).toBe(4_000);
    expect(b.right - b.left).toBe(a.right - a.left);
    expect(b.top - b.bottom).toBe(a.top - a.bottom);
  });

  test("a zoomed, panned view round-trips through world space", () => {
    const view = { cx: 0.32, cy: 0.71, halfW: 160, halfH: 120 };
    for (const bounds of [fovA, fovB]) {
      const back = worldRectToView(bounds, rectOf(viewToWorldFrame(bounds, view)));
      expect(back.cx).toBeCloseTo(view.cx, 10);
      expect(back.cy).toBeCloseTo(view.cy, 10);
      expect(back.halfW).toBeCloseTo(view.halfW, 10);
      expect(back.halfH).toBeCloseTo(view.halfH, 10);
    }
  });

  test("zoom transfers EXACTLY between FOVs, not approximately", () => {
    // Regression: zoom used to be a fraction of the FOV extent, so a follower
    // re-derived it and landed visibly wider than the card the user drove.
    // Carrying world half-extents makes the transfer exact.
    const driven = worldRectToView(fovA, rectOf(viewToWorldFrame(fovA, { cx: 0.4, cy: 0.6, halfW: 77, halfH: 55 })));
    const follower = viewToWorldFrame(fovB, driven);

    expect(follower.right - follower.left).toBeCloseTo(154, 9);
    expect(follower.top - follower.bottom).toBeCloseTo(110, 9);
  });

  test("a view read off one FOV reproduces the same region on another", () => {
    const driven = worldRectToView(
      fovA,
      rectOf(viewToWorldFrame(fovA, { cx: 0.25, cy: 0.25, halfW: 204.8, halfH: 204.8 })),
    );
    const onB = viewToWorldFrame(fovB, driven);

    expect(onB.left - fovB.translation.x).toBeCloseTo(0.25 * 2048 - 204.8, 6);
    expect(onB.right - fovB.translation.x).toBeCloseTo(0.25 * 2048 + 204.8, 6);
  });

  test("each axis keeps its own extent on a non-square FOV", () => {
    const wide: ViewBounds = { translation: { x: 0, y: 0 }, size: { width: 4000, height: 1000 } };
    const frame = viewToWorldFrame(wide, fullView(wide));

    expect(frame.right - frame.left).toBe(4000);
    expect(frame.top - frame.bottom).toBe(1000);
  });

  test("sameView suppresses float echo but still sees real motion", () => {
    const base = fullView(fovA);
    expect(sameView(base, { ...base, cx: 0.5 + 1e-9 })).toBe(true);
    expect(sameView(base, { ...base, cx: 0.5001 })).toBe(false);
    // Zoom alone must register: panning is not the only gesture.
    expect(sameView(base, { ...base, halfW: base.halfW - 10 })).toBe(false);
    expect(sameView(base, { ...base, halfH: base.halfH - 10 })).toBe(false);
  });
});
