import { describe, expect, test } from "bun:test";

import {
  addView,
  fillSlot,
  removeElement,
  removeNodeView,
  splitElement,
  stageIssues,
  stageViews,
  swapElements,
  type Stage,
} from "./stage-spec";

const nodes = new Set(["a", "b", "c"]);
const shown = (stage: Stage) => [...stageViews(stage).keys()].toSorted();

describe("Stage spec operations", () => {
  test("adding, splitting, filling, and removing keep a valid tree", () => {
    let stage = addView(addView(null, "a"), "b");
    expect(shown(stage)).toEqual(["a", "b"]);
    expect(stageIssues(stage, nodes)).toEqual([]);

    const [split, slot] = splitElement(stage, stageViews(stage).get("a")!, "up");
    stage = fillSlot(split, slot!, "c");
    expect(shown(stage)).toEqual(["a", "b", "c"]);
    expect(stageIssues(stage, nodes)).toEqual([]);

    // Filling a slot with a node already shown moves it; nothing appears twice.
    const [again, second] = splitElement(stage, stageViews(stage).get("b")!, "right");
    stage = fillSlot(again, second!, "a");
    expect(shown(stage)).toEqual(["a", "b", "c"]);
    expect(stageIssues(stage, nodes)).toEqual([]);

    stage = removeNodeView(removeNodeView(stage, "a"), "c");
    expect(shown(stage)).toEqual(["b"]);
    expect(Object.keys(stage!.elements)).toEqual([stage!.root]);
    expect(removeElement(stage, stage!.root)).toBeNull();
  });

  test("swapping two tiles exchanges what they show", () => {
    const stage = addView(addView(null, "a"), "b");
    const views = stageViews(stage);
    const swapped = swapElements(stage, views.get("a")!, views.get("b")!);
    expect(stageViews(swapped).get("a")).toBe(views.get("b"));
  });

  test("structural issues name the offending path", () => {
    const stage: Stage = {
      root: "s",
      elements: {
        s: { type: "Split", props: { direction: "row", ratio: 0.5 }, children: ["x", "x"] },
        x: { type: "View", props: { node: "ghost" }, children: [] },
        orphan: { type: "Slot", props: {}, children: [] },
      },
    };
    expect(stageIssues(stage, nodes)).toEqual([
      [["stage", "elements", "x", "props", "node"], 'unknown node "ghost"'],
      [["stage", "elements", "s", "children", "1"], 'element "x" appears twice'],
      [["stage", "elements", "orphan"], "unreachable from root"],
    ]);
  });
});
