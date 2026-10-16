/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import type { NodeBodyMounter } from "../contracts";
import { createTableDefinition } from "./definition";

describe("filter-coordinated view definitions", () => {
  test("Table declares filter coordination", () => {
    const tableDefinition = createTableDefinition({
      mountBody: (() => {
        throw new Error("not mounted by definition characterization");
      }) as NodeBodyMounter,
      services: { bodyHeaderElement: () => ({}) as HTMLElement },
    });
    expect(tableDefinition.capabilities).toEqual([
      "data-read",
      "filter-coordination",
      "ordering-coordination",
      "focus-coordination",
    ]);
  });
});
