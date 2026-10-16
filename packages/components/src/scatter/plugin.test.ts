import { describe, expect, test } from "vite-plus/test";
import type { BodyMounter } from "../contracts";
import { createScatterDefinition } from "./definition";
import type { ScatterServices } from "./contracts";

describe("Scatter definition", () => {
  test("binds its coordination types", () => {
    const scatterDefinition = createScatterDefinition({
      mountBody: (() => {
        throw new Error("not mounted by definition characterization");
      }) as BodyMounter,
      services: {} as ScatterServices,
    });
    expect(scatterDefinition.binds).toEqual(["focus", "filter", "colorBy", "viewSync"]);
  });
});
