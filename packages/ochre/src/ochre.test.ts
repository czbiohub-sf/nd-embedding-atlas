import { describe, expect, test } from "vite-plus/test";
import { Accent } from "./colormap/catalog/colorbrewer";
import { cividis } from "./colormap/catalog/cividis";
import {
  discreteColormap,
  linearColormap,
  ParseColorError,
  srgb,
  srgbFromHex,
  srgbToHex,
  srgbToOkLch,
  okLchToSrgb,
} from "./index";

const expectColorClose = (actual: ReturnType<typeof srgb>, expected: ReturnType<typeof srgb>) => {
  expect(actual.r).toBeCloseTo(expected.r, 5);
  expect(actual.g).toBeCloseTo(expected.g, 5);
  expect(actual.b).toBeCloseTo(expected.b, 5);
  expect(actual.alpha).toBeCloseTo(expected.alpha, 5);
};

describe("Ochre", () => {
  test("parses and formats short, long, and alpha hex colors", () => {
    expect(srgbToHex(srgbFromHex("#369"))).toBe("#336699");
    expect(srgbToHex(srgbFromHex("336699"))).toBe("#336699");
    expect(srgbToHex(srgbFromHex("#33669980"))).toBe("#33669980");
  });

  test("rejects malformed hex colors", () => {
    expect(() => srgbFromHex("#12")).toThrow(ParseColorError);
    expect(() => srgbFromHex("#gggggg")).toThrow(ParseColorError);
  });

  test("round-trips sRGB through Oklch", () => {
    const color = srgb(0.15, 0.5, 0.85, 0.4);
    expectColorClose(okLchToSrgb(srgbToOkLch(color)), color);
  });

  test("maps linear and discrete endpoints", () => {
    const black = srgb(0, 0, 0);
    const white = srgb(1, 1, 1);
    const linear = linearColormap({
      name: "gray",
      interpolation: "srgb",
      stops: [
        { position: 0, color: black },
        { position: 1, color: white },
      ],
    });
    const discrete = discreteColormap({ name: "binary", colors: [black, white] });

    expectColorClose(linear.map(-1), black);
    expectColorClose(linear.map(1), white);
    expectColorClose(discrete.map(0), black);
    expectColorClose(discrete.map(1), white);
  });

  test("exposes generated linear and discrete catalog entries", () => {
    expect(cividis.kind).toBe("linear");
    expect(Accent.kind).toBe("discrete");
  });
});
