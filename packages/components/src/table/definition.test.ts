/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import type { BodyMounter } from "../contracts";
import { createTableDefinition } from "./definition";

describe("table definition", () => {
  test("binds focus, filter, and ordering", () => {
    const tableDefinition = createTableDefinition({
      mountBody: (() => {
        throw new Error("not mounted by definition characterization");
      }) as BodyMounter,
    });
    expect(tableDefinition.binds).toEqual(["focus", "filter", "ordering"]);
  });
});
