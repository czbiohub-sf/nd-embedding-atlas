import { describe, expect, test } from "vite-plus/test";
import { scatterDefinition } from "./plugin";

describe("Scatter definition", () => {
  test("exposes exact native ports and host capabilities", () => {
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
