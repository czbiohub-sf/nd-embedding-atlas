import { expect, test } from "bun:test";

import { ND_STAGE } from "./constants";
import { sashRatio } from "./split-geometry";

const box = { left: 100, top: 50, width: 400, height: 200 };

test("a row split follows x, a column split follows y", () => {
  expect(sashRatio(box, 200, 999, false)).toBe(0.25);
  expect(sashRatio(box, 999, 200, true)).toBe(0.75);
});

test("the ratio clamps so neither pane collapses", () => {
  expect(sashRatio(box, 0, 0, false)).toBe(ND_STAGE.ratioMin);
  expect(sashRatio(box, 0, 1000, true)).toBe(ND_STAGE.ratioMax);
});
