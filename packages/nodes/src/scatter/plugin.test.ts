import { describe, expect, test } from "vite-plus/test";
import type { NodeBodyMounter } from "../contracts";
import { createScatterDefinition } from "./definition";
import type { ScatterServices } from "./contracts";

describe("Scatter definition", () => {
  test("exposes exact native ports and host capabilities", () => {
    const scatterDefinition = createScatterDefinition({
      mountBody: (() => {
        throw new Error("not mounted by definition characterization");
      }) as NodeBodyMounter,
      services: {} as ScatterServices,
    });
    expect(scatterDefinition.inputs.map(({ id, kind }) => [id, kind])).toEqual([["in", "pred"]]);
    expect(scatterDefinition.outputs).toEqual([]);
    expect(scatterDefinition.capabilities).toEqual([
      "data-read",
      "row-set-publish",
      "focus-coordination",
      "view-coordination",
      "filter-coordination",
      "schema-mutation",
      "gpu-device",
      "wasm-bitmap",
    ]);
  });
});
