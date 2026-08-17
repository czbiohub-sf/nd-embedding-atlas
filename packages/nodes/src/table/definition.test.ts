/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import type { NodeBodyMounter } from "../contracts";
import { createTableDefinition } from "./definition";

describe("filter-coordinated view definitions", () => {
  test("Table has no native selection input and declares filter coordination", () => {
    const tableDefinition = createTableDefinition({
      mountBody: (() => {
        throw new Error("not mounted by definition characterization");
      }) as NodeBodyMounter,
      services: { bodyHeaderElement: () => ({}) as HTMLElement },
    });
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
