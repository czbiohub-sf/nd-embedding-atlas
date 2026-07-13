import { describe, expect, test } from "bun:test";
import { type Domain, domainTicks, fmtVal, niceDomain, parseVal, posOf, valOf } from "@/nodes/annotate/range-scale";

describe("range-scale", () => {
  test("posOf/valOf map the domain endpoints and round-trip", () => {
    const d: Domain = [0, 10];
    expect(posOf(0, d)).toBeCloseTo(0);
    expect(posOf(10, d)).toBeCloseTo(1);
    expect(posOf(2.5, d)).toBeCloseTo(0.25);
    for (const t of [0, 0.25, 0.5, 0.9, 1]) expect(posOf(valOf(t, d), d)).toBeCloseTo(t);
  });

  test("posOf clamps values outside the domain", () => {
    const d: Domain = [0, 1];
    expect(posOf(-5, d)).toBe(0);
    expect(posOf(5, d)).toBe(1);
  });

  test("niceDomain auto-fits and pads; empty → [0,1]", () => {
    expect(niceDomain(null, null)).toEqual([0, 1]);
    const [lo, hi] = niceDomain(0.013, 0.1);
    expect(lo).toBe(0); // non-negative metric floored at 0
    expect(hi).toBeGreaterThan(0.1);
    // a single value still yields a domain that contains it
    const [a, b] = niceDomain(5, null);
    expect(a).toBeLessThanOrEqual(5);
    expect(b).toBeGreaterThanOrEqual(5);
    // negative values are allowed below 0
    expect(niceDomain(-3, 2)[0]).toBeLessThan(0);
  });

  test("domainTicks are evenly spaced across the domain, endpoints included", () => {
    expect(domainTicks([0, 8], 5)).toEqual([0, 2, 4, 6, 8]);
  });

  test("fmtVal is generic — scientific only at the extremes", () => {
    expect(fmtVal(0)).toBe("0");
    expect(fmtVal(0.013)).toBe("0.013");
    expect(fmtVal(42.5)).toBe("42.5");
    expect(fmtVal(1e-4)).toBe("1.0e-4");
    expect(fmtVal(12345)).toBe("1.2e+4");
    expect(fmtVal(null)).toBe("");
  });

  test("parseVal accepts any finite number (incl. negatives/zero), rejects the rest", () => {
    expect(parseVal("0.5")).toBe(0.5);
    expect(parseVal("-3")).toBe(-3);
    expect(parseVal("0")).toBe(0);
    expect(parseVal("1e-2")).toBe(0.01);
    expect(parseVal("")).toBeNull();
    expect(parseVal("abc")).toBeNull();
    expect(parseVal("Infinity")).toBeNull();
  });
});
