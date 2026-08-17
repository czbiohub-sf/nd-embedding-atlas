/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { isVersionCompatible } from "./index.ts";

describe("isVersionCompatible", () => {
  test("supports the catalog range forms from one SDK-owned helper", () => {
    const compatible = [
      "1.2.3",
      "1.2",
      "^1.2.0",
      "~1.2.0",
      ">=1.0.0 <2.0.0",
      "1.0.0 - 1.9.9",
      "1.2.x",
      ">=9.0.0 || ^1.2.0",
      "*",
      "latest",
    ];
    for (const range of compatible) expect(isVersionCompatible("1.2.3", range), range).toBe(true);
  });

  test("rejects incompatible, malformed, empty, and invalid concrete versions", () => {
    const incompatible = ["^2.0.0", "<1.0.0", "1.3.x", "not-a-range", ""];
    for (const range of incompatible) expect(isVersionCompatible("1.2.3", range), range).toBe(false);
    expect(isVersionCompatible("not-a-version", "*")).toBe(false);
  });

  test("orders prereleases before their release", () => {
    expect(isVersionCompatible("1.2.3-beta.1", ">=1.2.3")).toBe(false);
    expect(isVersionCompatible("1.2.3", ">1.2.3-beta.1")).toBe(true);
  });
});
