import { describe, expect, test } from "bun:test";
import { defaultParams, defaultSpec, featureStats } from "./defaults";
import { curveBounds, desirability, DIRECTIONS, SHAPES, squaredDistance } from "./desirability";

/** Distributions that have each broken a naive default at some point. */
const DISTRIBUTIONS: Record<string, number[]> = {
  typical: [0.1, 0.2, 0.3, 0.45, 0.5, 0.55, 0.7, 0.8, 0.95],
  // Every value identical: extent is 0, so any width derived from the extent is 0 too.
  constant: [5000, 5000, 5000, 5000],
  // Entirely negative: `lognormal` has no positive anchor to centre on.
  negative: [-8, -5, -3, -1],
  // Straddles zero, so a positive centre must come from the upper half.
  straddling: [-2, -1, 0, 1, 2],
  // A tight core with one far outlier: q25 == q75 while the extent is wide.
  spiked: [1, 1, 1, 1, 1, 1, 1, 900],
  allMissing: [Number.NaN, Number.NaN],
  single: [42],
};

describe("featureStats", () => {
  test("quantiles interpolate the way numpy's default does", () => {
    // [1..5]: q25 sits a quarter of the way along 4 gaps, i.e. at index 1.0 exactly.
    const s = featureStats([1, 2, 3, 4, 5]);
    expect(s).toMatchObject({ lo: 1, hi: 5, q25: 2, median: 3, q75: 4, missing: 0 });
  });

  test("non-finite values are counted as missing, not binned as zero", () => {
    const s = featureStats([1, Number.NaN, 3, Number.POSITIVE_INFINITY]);
    expect(s).toMatchObject({ lo: 1, hi: 3, missing: 2 });
  });

  test("an all-missing feature still yields a usable domain", () => {
    // Returning NaN bounds here would propagate into every curve drawn on the plot.
    const s = featureStats(DISTRIBUTIONS.allMissing);
    expect(s.hi).toBeGreaterThan(s.lo);
    expect(s.missing).toBe(2);
  });
});

describe("defaultParams", () => {
  // The load-bearing property. `curveBounds` THROWS on `fwhm <= 0`, `fold <= 1` and
  // `center <= 0`, and a shape switch replaces the whole parameter set, so an invalid default
  // does not degrade the plot -- it blanks it and the throw escapes the render.
  for (const [label, values] of Object.entries(DISTRIBUTIONS)) {
    for (const shape of SHAPES) {
      for (const direction of DIRECTIONS) {
        test(`${shape}/${direction} over a ${label} feature is a drawable curve`, () => {
          const stats = featureStats(values);
          const params = defaultParams(shape, direction, stats);
          for (const [key, value] of Object.entries(params)) {
            expect(Number.isFinite(value), `${key} = ${value}`).toBe(true);
          }
          const bounds = curveBounds(shape, direction, params);
          for (const value of [...values, stats.lo, stats.hi, stats.median, 0, -1]) {
            const d = desirability(value, shape, direction, bounds);
            expect(d).toBeGreaterThanOrEqual(0);
            expect(d).toBeLessThanOrEqual(1);
            expect(Number.isFinite(squaredDistance(value, shape, direction, bounds))).toBe(true);
          }
        });
      }
    }
  }

  test("a bell lands on the data it was derived from", () => {
    const stats = featureStats(DISTRIBUTIONS.typical);
    const params = defaultParams("gaussian", "target", stats);
    const bounds = curveBounds("gaussian", "target", params);
    // The median must score better than either extreme, or "prefer typical" is a lie.
    expect(desirability(stats.median, "gaussian", "target", bounds)).toBeGreaterThan(
      desirability(stats.lo, "gaussian", "target", bounds),
    );
    expect(desirability(stats.median, "gaussian", "target", bounds)).toBeGreaterThan(
      desirability(stats.hi, "gaussian", "target", bounds),
    );
  });

  test("lognormal centres on the largest positive anchor it can find", () => {
    // Not on the median, which is negative here -- `curveBounds` would throw on that.
    const params = defaultParams("lognormal", "target", featureStats(DISTRIBUTIONS.straddling));
    expect(params.center).toBeGreaterThan(0);
    expect(params.fold).toBeGreaterThan(1);
  });

  test("a constant feature gets a width scaled to its magnitude, not to 1", () => {
    // fwhm 1 on a feature sitting at 5000 is a spike narrower than a pixel.
    const params = defaultParams("gaussian", "target", featureStats(DISTRIBUTIONS.constant));
    expect(params.fwhm).toBeGreaterThan(100);
  });

  test("lower-is-better runs the linear pair backwards down the axis", () => {
    const stats = featureStats(DISTRIBUTIONS.typical);
    const lower = defaultParams("linear", "lower", stats);
    expect(lower.onset).toBe(stats.hi);
    expect(lower.ideal).toBe(stats.lo);
    const bounds = curveBounds("linear", "lower", lower);
    expect(desirability(stats.lo, "linear", "lower", bounds)).toBeGreaterThan(
      desirability(stats.hi, "linear", "lower", bounds),
    );
  });
});

describe("defaultSpec", () => {
  test("opens enabled with unit weight", () => {
    // Every feature off would show a score of 0 and an accuracy of 0 for every FOV, which is
    // indistinguishable from a broken tool.
    const spec = defaultSpec(featureStats(DISTRIBUTIONS.typical));
    expect(spec).toMatchObject({ shape: "gaussian", direction: "target", weight: 1, enabled: true });
  });
});
