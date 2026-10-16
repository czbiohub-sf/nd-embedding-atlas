import { describe, expect, test } from "vite-plus/test";
import type { NodeBodyMounter } from "../contracts";
import { createScatterDefinition } from "./definition";
import type { ScatterServices } from "./contracts";

describe("Scatter definition", () => {
  test("declares its host capabilities", () => {
    const scatterDefinition = createScatterDefinition({
      mountBody: (() => {
        throw new Error("not mounted by definition characterization");
      }) as NodeBodyMounter,
      services: {} as ScatterServices,
    });
    expect(scatterDefinition.capabilities).toEqual([
      "data-read",
      "row-set-publish",
      "focus-coordination",
      "view-coordination",
      "filter-coordination",
      "color-coordination",
      "schema-mutation",
      "gpu-device",
      "wasm-bitmap",
    ]);
  });
});
