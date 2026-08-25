import { describe, expect, test } from "bun:test";
import { looksLikeMask } from "./useFovChannels";

/** Measured from the real h2bc21 bf_midslice seg store via /api/channel-stats. */
const BRIGHTFIELD = { lo: 0.001953125, hi: 0.998046875, dataMin: 0, dataMax: 1 };
const INSTANCE_LABELS = { lo: 0.064453125, hi: 32.935546875, dataMin: 0, dataMax: 33 };

describe("looksLikeMask", () => {
  test("an instance-label channel is a mask", () => {
    // 33 objects segmented in this field: IDs, not intensities. Stretching 0..33 by
    // percentile would make object 33 look brighter than object 1, which means nothing.
    expect(looksLikeMask(INSTANCE_LABELS)).toBe(true);
  });

  test("a float intensity channel is not", () => {
    expect(looksLikeMask(BRIGHTFIELD)).toBe(false);
  });

  test("a normalised 0..1 channel is not, even though its max is integral", () => {
    expect(looksLikeMask({ lo: 0, hi: 1, dataMin: 0, dataMax: 1 })).toBe(false);
  });

  test("absent stats are not a mask", () => {
    expect(looksLikeMask()).toBe(false);
  });

  test("a raw 16-bit camera channel is not treated as a label image", () => {
    // dataMax 65535 is integral and non-negative but far past any plausible object count.
    expect(looksLikeMask({ lo: 100, hi: 4000, dataMin: 0, dataMax: 65535 })).toBe(false);
  });
});
