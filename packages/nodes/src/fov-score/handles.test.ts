import { describe, expect, test } from "bun:test";
import { defaultParams, featureStats } from "./defaults";
import { curveBounds, desirability, DIRECTIONS, SHAPES } from "./desirability";
import { curveHandles, dragHandle } from "./handles";

const STATS = featureStats([0.1, 0.2, 0.3, 0.45, 0.5, 0.55, 0.7, 0.8, 0.95]);
const DOMAIN: readonly [number, number] = [STATS.lo, STATS.hi];

/** Positions a real drag reaches, including well past both ends of the plot. */
const TARGETS = [-5, STATS.lo, STATS.q25, STATS.median, STATS.q75, STATS.hi, 5, 0];

describe("curveHandles", () => {
  for (const shape of SHAPES) {
    for (const direction of DIRECTIONS) {
      test(`${shape}/${direction} handles all edit real parameters`, () => {
        const params = defaultParams(shape, direction, STATS);
        const handles = curveHandles(shape, direction, params);
        expect(handles.length).toBeGreaterThan(0);
        for (const handle of handles) {
          // A handle whose key is not a parameter silently does nothing when dragged.
          expect(Object.keys(params)).toContain(handle.key);
          expect(Number.isFinite(handle.x)).toBe(true);
          expect(handle.y).toBeGreaterThanOrEqual(0);
          expect(handle.y).toBeLessThanOrEqual(1);
        }
        expect(new Set(handles.map((h) => h.key)).size).toBe(handles.length);
      });
    }
  }

  test("a handle sits where its parameter means", () => {
    // Grab the FWHM handle at half maximum, so what you grab is what the number describes.
    const params = { center: 10, fwhm: 4 };
    const handles = curveHandles("gaussian", "target", params);
    const width = handles.find((h) => h.key === "fwhm")!;
    expect(width.x).toBe(12);
    const bounds = curveBounds("gaussian", "target", params);
    expect(desirability(width.x, "gaussian", "target", bounds)).toBeCloseTo(0.5, 6);
  });
});

describe("dragHandle", () => {
  // The reason this module exists: `curveBounds` throws on a violated invariant, and a throw
  // mid-gesture escapes the render and blanks the plot. Every reachable drag must clamp.
  for (const shape of SHAPES) {
    for (const direction of DIRECTIONS) {
      test(`${shape}/${direction} survives a drag to anywhere`, () => {
        let params = defaultParams(shape, direction, STATS);
        for (const handle of curveHandles(shape, direction, params)) {
          for (const x of TARGETS) {
            params = dragHandle(shape, direction, params, handle.key, x, DOMAIN);
            for (const [key, value] of Object.entries(params)) {
              expect(Number.isFinite(value), `${shape}/${direction} ${key} = ${value}`).toBe(true);
            }
            const bounds = curveBounds(shape, direction, params);
            const d = desirability(STATS.median, shape, direction, bounds);
            expect(Number.isFinite(d)).toBe(true);
          }
        }
      });
    }
  }

  test("does not mutate the params it was given", () => {
    // The view holds the previous object in config; mutating it would defeat the memo.
    const params = { center: 10, fwhm: 4 };
    dragHandle("gaussian", "target", params, "center", 99, DOMAIN);
    expect(params).toEqual({ center: 10, fwhm: 4 });
  });

  test("a centre drag follows the pointer exactly", () => {
    const next = dragHandle("gaussian", "target", { center: 10, fwhm: 4 }, "center", 7.5, DOMAIN);
    expect(next).toEqual({ center: 10 - 2.5, fwhm: 4 });
  });

  test("dragging a width handle to the centre clamps instead of collapsing", () => {
    // fwhm 0 makes `curveBounds` throw; the curve must narrow to its limit and stop.
    const next = dragHandle("gaussian", "target", { center: 10, fwhm: 4 }, "fwhm", 10, DOMAIN);
    expect(next.fwhm).toBeGreaterThan(0);
    expect(() => curveBounds("gaussian", "target", next)).not.toThrow();
  });

  test("a width drag is symmetric: either side gives the same width", () => {
    const left = dragHandle("gaussian", "target", { center: 10, fwhm: 4 }, "fwhm", 7, DOMAIN);
    const right = dragHandle("gaussian", "target", { center: 10, fwhm: 4 }, "fwhm", 13, DOMAIN);
    expect(left.fwhm).toBeCloseTo(right.fwhm, 12);
    expect(left.fwhm).toBeCloseTo(6, 12);
  });

  test("band edges cannot cross", () => {
    const params = { half_band_lo: 2, half_band_hi: 8, width: 1 };
    const pushed = dragHandle("sigmoid", "target", params, "half_band_lo", 99, DOMAIN);
    expect(pushed.half_band_lo).toBeLessThan(pushed.half_band_hi);
    const pulled = dragHandle("sigmoid", "target", params, "half_band_hi", -99, DOMAIN);
    expect(pulled.half_band_hi).toBeGreaterThan(pulled.half_band_lo);
  });

  test("lognormal keeps fold above 1 and centre above 0", () => {
    const params = { center: 10, fold: 2 };
    expect(dragHandle("lognormal", "target", params, "fold", 0, DOMAIN).fold).toBeGreaterThan(1);
    expect(dragHandle("lognormal", "target", params, "center", -50, DOMAIN).center).toBeGreaterThan(0);
  });

  test("linear onset and ideal cannot collapse onto each other", () => {
    const params = { onset: 0, ideal: 1 };
    const collapsed = dragHandle("linear", "higher", params, "onset", 1, DOMAIN);
    expect(collapsed.onset).not.toBe(collapsed.ideal);
    const bounds = curveBounds("linear", "higher", collapsed);
    expect(Number.isFinite(desirability(0.5, "linear", "higher", bounds))).toBe(true);
  });

  test("shoulders clamp at zero rather than going negative", () => {
    // A negative shoulder would invert `min(rising, falling)` and desirability would read 1
    // outside the range instead of 0.
    const params = { range_lo: 2, range_hi: 8, soft_left: 1, soft_right: 1 };
    expect(dragHandle("linear", "target", params, "soft_left", 99, DOMAIN).soft_left).toBe(0);
    expect(dragHandle("linear", "target", params, "soft_right", -99, DOMAIN).soft_right).toBe(0);
  });

  test("an unknown handle key is a no-op, not a corruption", () => {
    const params = { center: 10, fwhm: 4 };
    expect(dragHandle("gaussian", "target", params, "nope", 1, DOMAIN)).toEqual(params);
  });
});
