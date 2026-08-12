import { describe, expect, test } from "bun:test";

import { countPlotDefinition } from "../count-plot/plugin";
import { histogramDefinition } from "../histogram/plugin";
import { vgplotDefinition } from "../vgplot/plugin";
import { tableDefinition } from "../../table/plugin";

describe("filter-coordinated view definitions", () => {
  test.each([countPlotDefinition, histogramDefinition, vgplotDefinition])(
    "$title has only graph predicate input and no native selection output",
    (definition) => {
      expect(definition.inputs).toEqual([{ id: "in", kind: "pred", label: "In" }]);
      expect(definition.outputs).toEqual([]);
      expect(definition.capabilities).toEqual(["data-read", "filter-coordination"]);
    },
  );

  test("Table has no native selection input and declares filter coordination", () => {
    expect(tableDefinition.inputs).toEqual([{ id: "in", kind: "pred", label: "In" }]);
    expect(tableDefinition.outputs).toEqual([{ id: "out", kind: "focus", label: "Focus" }]);
    expect(tableDefinition.capabilities).toEqual([
      "data-read",
      "filter-coordination",
      "ordering-coordination",
      "focus-coordination",
    ]);
  });
});
