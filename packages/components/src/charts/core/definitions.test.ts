/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import type { BodyMounter } from "../../contracts";
import { createCountPlotDefinition } from "../count-plot/definition";
import { createHistogramDefinition } from "../histogram/definition";
import { createVgplotDefinition } from "../vgplot/definition";
import type { ChartServices } from "./contracts";

const mountBody = (() => {
  throw new Error("not mounted in metadata tests");
}) as BodyMounter;

const services: ChartServices = {
  useQuery: () => ({ data: null, loading: false, error: null }),
};

const definitions = [
  createCountPlotDefinition({ mountBody, services }),
  createHistogramDefinition({ mountBody, services }),
  createVgplotDefinition(),
];

describe("filter-coordinated chart definitions", () => {
  test.each(definitions)("$title binds filter", (definition) => {
    expect(definition.binds).toEqual(["filter"]);
  });
});
