/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { ComponentHost } from "@ndea/sdk";

function typeContract(host: ComponentHost): void {
  void host.filter.publishSelection;
  // @ts-expect-error a selection becomes a set only through filter.publishSelection
  void host.dataAPI.createObservationSet;
  // @ts-expect-error views query through host.data.coordinator
  void host.dataAPI.query;
}

describe("host types", () => {
  test("keeps compile-time assertions out of runtime execution", () => {
    expect(typeContract).toBeFunction();
  });
});
