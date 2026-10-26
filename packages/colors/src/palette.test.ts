/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { srgbToHex } from "./color";
import { Accent } from "./colormap/catalog/colorbrewer";
import { viridis } from "./colormap/catalog/bids";
import { categoricalColormaps, continuousColormaps, resolveColormap, samplePalette } from "./palette";

describe("palette", () => {
  test("resolves curated categorical and every linear name; unknown is null", () => {
    expect(resolveColormap("Accent")).toBe(Accent);
    expect(resolveColormap("viridis")).toBe(viridis);
    expect(resolveColormap("glasbey")?.kind).toBe("linear");
    expect(resolveColormap("nope")).toBeNull();
    expect(Object.keys(categoricalColormaps)[0]).toBe("Category10");
    expect(Object.values(continuousColormaps).every((c) => c.kind === "linear")).toBe(true);
  });

  test("prefixes later sources on a linear name collision", () => {
    const prefixed = Object.keys(continuousColormaps).filter((name) => name.includes(":"));
    expect(prefixed.length).toBeGreaterThan(0);
    for (const name of prefixed) expect(continuousColormaps[name.slice(name.indexOf(":") + 1)]).toBeDefined();
  });

  test("discrete palettes cycle, linear ones sample endpoints and the midpoint", () => {
    const accent = Accent.colors.map(srgbToHex);
    expect(samplePalette("Accent", accent.length + 2)).toEqual([...accent, accent[0], accent[1]]);
    expect(samplePalette("viridis", 2)).toEqual([srgbToHex(viridis.map(0)), srgbToHex(viridis.map(1))]);
    expect(samplePalette("viridis", 1)).toEqual([srgbToHex(viridis.map(0.5))]);
    expect(samplePalette("viridis", 0)).toEqual([]);
  });

  test("unknown names are grayscale; arrays are stable per (name, n)", () => {
    expect(samplePalette("nope", 3)).toEqual(["#000000", "#808080", "#FFFFFF"]);
    expect(samplePalette("nope", 1)).toEqual(["#808080"]);
    expect(samplePalette("viridis", 5)).toBe(samplePalette("viridis", 5));
  });
});
