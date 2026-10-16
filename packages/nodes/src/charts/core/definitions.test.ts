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
  test.each(definitions)("$title declares filter coordination", (definition) => {
    expect(definition.capabilities).toEqual(["data-read", "filter-coordination"]);
  });
});
