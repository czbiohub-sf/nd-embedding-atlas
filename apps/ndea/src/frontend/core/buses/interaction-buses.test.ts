import { describe, expect, test } from "bun:test";
import { rowIndex, type RowIndex } from "@ndea/sdk";
import { createFocusBus } from "./focus-bus";

describe("interaction buses", () => {
  test("focus set, replacement, clear, and unsubscribe", () => {
    const focus = createFocusBus();
    const seen: (RowIndex | null)[] = [];
    const unsubscribe = focus.subscribe((value) => seen.push(value));

    focus.set(rowIndex(3));
    focus.set(rowIndex(8));
    focus.clear();

    expect(focus.get()).toBeNull();
    expect(seen).toEqual([rowIndex(3), rowIndex(8), null]);

    unsubscribe();
    focus.set(rowIndex(13));
    expect(seen).toEqual([rowIndex(3), rowIndex(8), null]);
  });
});
