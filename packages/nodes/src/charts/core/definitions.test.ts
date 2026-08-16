/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import type { NodeBodyMounter } from "../../contracts";
import { createCountPlotDefinition } from "../count-plot/definition";
import { createHistogramDefinition } from "../histogram/definition";
import { createVgplotDefinition } from "../vgplot/definition";
import type { ChartServices } from "./contracts";

const mountBody = (() => {
  throw new Error("not mounted in metadata tests");
}) as NodeBodyMounter;

const services: ChartServices = {
  useColumnTypes: () => null,
  useQuery: () => ({ data: null, loading: false, error: null }),
};

const definitions = [
  createCountPlotDefinition({ mountBody, services }),
  createHistogramDefinition({ mountBody, services }),
  createVgplotDefinition(),
];

describe("filter-coordinated chart definitions", () => {
  test.each(definitions)("$title has only graph predicate input and no native selection output", (definition) => {
    expect(definition.inputs).toEqual([{ id: "in", kind: "pred", label: "In" }]);
    expect(definition.outputs).toEqual([]);
    expect(definition.capabilities).toEqual(["data-read", "filter-coordination"]);
  });
});
