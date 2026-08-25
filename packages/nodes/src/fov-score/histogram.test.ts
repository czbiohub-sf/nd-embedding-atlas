import { describe, expect, test } from "bun:test";
import { featureHistogram, type HistogramInput } from "./histogram";

const rows = (...specs: [number, HistogramInput["goodness"]][]): HistogramInput[] =>
  specs.map(([value, goodness]) => ({ value, goodness }));

describe("featureHistogram", () => {
  test("counts every measured row exactly once, split by label", () => {
    const h = featureHistogram(rows([0, "bad"], [0.25, "bad"], [0.5, "neutral"], [0.75, "good"], [1, "good"]), 4);
    const sum = (key: keyof (typeof h.bins)[number]) => h.bins.reduce((a, b) => a + b[key], 0);
    expect(sum("total")).toBe(5);
    expect(sum("good")).toBe(2);
    expect(sum("neutral")).toBe(1);
    expect(sum("bad")).toBe(2);
  });

  test("the top edge lands in the last bin rather than falling off", () => {
    // value === max computes index n, which must clamp: otherwise the largest field silently
    // vanishes from the plot.
    const h = featureHistogram(rows([0, "bad"], [1, "good"]), 4);
    expect(h.bins.at(-1)?.total).toBe(1);
    expect(h.bins.reduce((a, b) => a + b.total, 0)).toBe(2);
  });

  test("non-finite values are reported as missing, never binned as zero", () => {
    // A NaN feature costs score (MISSING_DESIRABILITY); binning it at 0 would both distort
    // the distribution and hide the fact that it could not be measured.
    const h = featureHistogram(rows([Number.NaN, "bad"], [0.5, "good"], [Number.NaN, "neutral"]), 4);
    expect(h.missing).toBe(2);
    expect(h.bins.reduce((a, b) => a + b.total, 0)).toBe(1);
  });

  test("all-identical values still produce a drawable domain", () => {
    const h = featureHistogram(rows([7, "good"], [7, "good"], [7, "bad"]), 4);
    expect(h.domain[1]).toBeGreaterThan(h.domain[0]);
    expect(h.bins.reduce((a, b) => a + b.total, 0)).toBe(3);
  });

  test("a supplied domain is respected and outliers clamp into the end bins", () => {
    // The domain is pinned while dragging a curve; values beyond it must still be counted or
    // the bar heights would change as the axis stopped moving.
    const h = featureHistogram(rows([-5, "bad"], [0.5, "good"], [99, "good"]), 4, [0, 1]);
    expect(h.domain).toEqual([0, 1]);
    expect(h.bins[0].total).toBe(1);
    expect(h.bins.at(-1)?.total).toBe(1);
    expect(h.bins.reduce((a, b) => a + b.total, 0)).toBe(3);
  });

  test("maxCount scales the bars", () => {
    const h = featureHistogram(rows([0.1, "bad"], [0.1, "bad"], [0.1, "good"], [0.9, "good"]), 2);
    expect(h.maxCount).toBe(3);
  });

  test("no measured rows yields an empty but usable result", () => {
    const h = featureHistogram(rows([Number.NaN, "bad"]), 4);
    expect(h.bins).toHaveLength(0);
    expect(h.missing).toBe(1);
    expect(h.domain).toEqual([0, 1]);
    expect(h.maxCount).toBe(0);
  });

  test("separating vs non-separating features look different in the counts", () => {
    // This is the whole point of the label overlay: coverage_frac-like separation shows good
    // and bad in different bins, a useless feature shows them in the same ones.
    const separating = featureHistogram(rows([0.1, "bad"], [0.15, "bad"], [0.9, "good"], [0.95, "good"]), 2);
    expect(separating.bins[0]).toMatchObject({ bad: 2, good: 0 });
    expect(separating.bins[1]).toMatchObject({ bad: 0, good: 2 });

    const useless = featureHistogram(rows([0.1, "bad"], [0.9, "bad"], [0.15, "good"], [0.95, "good"]), 2);
    expect(useless.bins[0]).toMatchObject({ bad: 1, good: 1 });
    expect(useless.bins[1]).toMatchObject({ bad: 1, good: 1 });
  });
});
