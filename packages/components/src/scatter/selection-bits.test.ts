import { describe, expect, test } from "bun:test";
import { combineSelection, invertSelection, isEmptySelection } from "./selection-bits";

describe("selection bitmasks", () => {
  const prev = new Uint32Array([0b0110, 0b1]);
  const shape = new Uint32Array([0b1100, 0]);

  test("replace, add, and subtract combine with the current selection", () => {
    expect([...combineSelection(prev, shape, "replace")]).toEqual([0b1100, 0]);
    expect([...combineSelection(null, shape, "add")]).toEqual([0b1100, 0]);
    expect([...combineSelection(null, shape, "subtract")]).toEqual([0, 0]);
    expect([...combineSelection(prev, shape, "add")]).toEqual([0b1110, 0b1]);
    expect([...combineSelection(prev, shape, "subtract")]).toEqual([0b0010, 0b1]);
  });

  test("invert flips every row and keeps padding past the last row clear", () => {
    // 35 rows: word 1 holds rows 32..34 only.
    expect([...invertSelection(prev, 35)]).toEqual([~0b0110 >>> 0, 0b110]);
    expect([...invertSelection(new Uint32Array(2), 64)]).toEqual([0xffffffff, 0xffffffff]);
    expect(isEmptySelection(invertSelection(new Uint32Array([0xffffffff, 0b111]), 35))).toBe(true);
  });
});
