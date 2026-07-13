import { describe, expect, test } from "bun:test";

import { binParams, histogramBrushPredicate } from "./binmath";

describe("binParams", () => {
  test("uniform range → binStart + binSize", () => {
    expect(binParams({ min: 0, max: 100, count: 1000 }, 20)).toEqual({ binStart: 0, binSize: 5 });
  });

  test("constant column (min === max) → null", () => {
    expect(binParams({ min: 5, max: 5, count: 10 }, 20)).toBeNull();
  });

  test("no rows → null", () => {
    expect(binParams({ min: 0, max: 10, count: 0 }, 20)).toBeNull();
    expect(binParams(null, 20)).toBeNull();
  });
});

describe("histogramBrushPredicate", () => {
  test("lo < hi → isBetween filter", () => {
    const sql = histogramBrushPredicate("x", 1, 5);
    expect(sql).toContain("BETWEEN");
    expect(sql).toContain("1");
    expect(sql).toContain("5");
  });

  test("reversed endpoints are sorted", () => {
    expect(histogramBrushPredicate("x", 5, 1)).toBe(histogramBrushPredicate("x", 1, 5));
  });

  test("zero-width brush → null", () => {
    expect(histogramBrushPredicate("x", 3, 3)).toBeNull();
  });
});
