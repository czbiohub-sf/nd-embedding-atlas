import { expect, test } from "bun:test";
import { statOf } from "./channel-stats.ts";

test("statOf: extent + percentile saturation on a ramp", () => {
  // 0..255 uniform ramp: extent is exact; percentiles sit just inside the ends.
  const ramp = Uint16Array.from({ length: 256 }, (_, i) => i);
  const s = statOf(ramp);

  expect(s.dataMin).toBe(0);
  expect(s.dataMax).toBe(255);
  expect(s.bins).toHaveLength(256);
  // Low percentile (1%) lands near the bottom but above 0; high (99.8%) near top.
  expect(s.lo).toBeGreaterThan(0);
  expect(s.lo).toBeLessThan(20);
  expect(s.hi).toBeGreaterThan(240);
  expect(s.lo).toBeLessThan(s.hi);
});

test("statOf: background spike does not drag the low limit to zero's neighbourhood only", () => {
  // 990 background pixels at 5, 10 signal pixels at 1000. Percentile low must
  // sit at background; high must reach toward the bright tail: not the mean.
  const data = new Uint16Array(1000);
  data.fill(5);
  for (let i = 0; i < 10; i++) data[i] = 1000;
  const s = statOf(data);

  expect(s.dataMin).toBe(5);
  expect(s.dataMax).toBe(1000);
  expect(s.lo).toBeLessThan(50); // stays at background
  expect(s.hi).toBeGreaterThan(s.lo);
});

test("statOf: flat data never returns lo >= hi (idetik would throw)", () => {
  const s = statOf(new Uint16Array(64).fill(42));
  expect(s.lo).toBeLessThan(s.hi);
});
