import { expect, test } from "bun:test";

import { dropEdit } from "./tile-drag";

test("a drop is one edit: a tab onto a strip moves, anything onto a tile body swaps, nowhere does nothing", () => {
  expect(dropEdit({ tile: "a", tab: "t", over: "b", strip: true })).toEqual({ op: "move_tab", id: "t", to: "b" });
  expect(dropEdit({ tile: "a", tab: "t", over: "b", strip: false })).toEqual({ op: "swap", a: "a", b: "b" });
  expect(dropEdit({ tile: "a", over: "b", strip: false })).toEqual({ op: "swap", a: "a", b: "b" });
  expect(dropEdit({ tile: "a", over: "a", strip: false })).toBeNull();
  expect(dropEdit({ tile: "a", tab: "t", over: null, strip: false })).toBeNull();
});
