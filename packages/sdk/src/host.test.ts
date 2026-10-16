/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { ComponentHost, DataQueryAPI } from "@ndea/sdk";

function typeContract(host: ComponentHost, dataAPI: DataQueryAPI): void {
  void host.dataAPI.createObservationSet;
  // @ts-expect-error set creation exists only under dataAPI
  void host.createObservationSet;
  // @ts-expect-error query results cannot be selected by callers
  void dataAPI.query<{ n: number }>("SELECT 1");
}

describe("host types", () => {
  test("keeps compile-time assertions out of runtime execution", () => {
    expect(typeContract).toBeFunction();
  });
});
