import { describe, expect, test } from "bun:test";
import { resolveCropZ } from "./useGalleryCropQuery";

describe("resolveCropZ", () => {
  test("prefers per-row Z over live viewer Z", () => {
    expect(resolveCropZ(2, 7)).toBe(2);
  });

  test("falls back to live viewer Z when row Z is absent", () => {
    expect(resolveCropZ(undefined, 3)).toBe(3);
    expect(resolveCropZ(null, 3)).toBe(3);
  });

  test("defaults to plane zero and rounds slab indices", () => {
    expect(resolveCropZ(null, null)).toBe(0);
    expect(resolveCropZ(2.6, 8.4)).toBe(3);
    expect(resolveCropZ(undefined, 8.4)).toBe(8);
  });
});
