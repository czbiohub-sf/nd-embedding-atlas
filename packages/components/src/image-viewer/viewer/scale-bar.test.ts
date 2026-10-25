import { expect, test } from "bun:test";
import { roundLength, unitSymbol } from "./scale-bar";

test("roundLength picks the largest 1/2/5 × 10^n not above the max", () => {
  expect(roundLength(96)).toBe(50);
  expect(roundLength(20)).toBe(20);
  expect(roundLength(19.9)).toBe(10);
  expect(roundLength(0.37)).toBeCloseTo(0.2);
  expect(roundLength(4999)).toBe(2000);
});

test("unitSymbol maps OME-Zarr units", () => {
  expect(unitSymbol()).toBe("µm");
  expect(unitSymbol("nanometer")).toBe("nm");
  expect(unitSymbol("parsec")).toBe("parsec");
});
