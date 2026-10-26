import { expect, test } from "bun:test";

import { getByPath, resolveExpressions } from "./expressions";

const state = { focus: { A: 7, "a/b": 1, "t~x": 2 }, colorBy: { A: null }, list: ["x", "y"] };

test("getByPath walks a JSON Pointer through objects and arrays", () => {
  expect(getByPath(state, "/focus/A")).toBe(7);
  expect(getByPath(state, "/list/1")).toBe("y");
  expect(getByPath(state, "/focus/a~1b")).toBe(1);
  expect(getByPath(state, "/focus/t~0x")).toBe(2);
  expect(getByPath(state, "")).toBe(state);
  expect(getByPath(state, "/")).toBe(state);
  expect(getByPath(state, "/focus/B")).toBeUndefined();
  expect(getByPath(state, "/colorBy/A/deeper")).toBeUndefined();
  expect(getByPath(state, "/focus/toString")).toBeUndefined();
});

test("$state reads a value; $template interpolates, missing values as empty", () => {
  expect(resolveExpressions({ $state: "/focus/A" }, state)).toBe(7);
  expect(resolveExpressions({ $template: "Focus ${/focus/A} of ${list}, ${/colorBy/A}|${/nope}" }, state)).toBe(
    'Focus 7 of ["x","y"], |',
  );
});

test("expressions resolve anywhere in a value; everything else passes through", () => {
  expect(
    resolveExpressions({ text: { $state: "/list/0" }, n: 1, rows: [{ $template: "#${/focus/A}" }, null] }, state),
  ).toEqual({
    text: "x",
    n: 1,
    rows: ["#7", null],
  });
  expect(resolveExpressions("${/focus/A}", state)).toBe("${/focus/A}");
});
