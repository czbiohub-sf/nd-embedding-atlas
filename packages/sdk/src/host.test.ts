/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { DataQueryAPI, NodeHost, NodeModule } from "@ndea/sdk";

function typeContract(host: NodeHost, dataAPI: DataQueryAPI): void {
  // @ts-expect-error capability-free hosts do not expose data services
  void host.dataAPI;
  // @ts-expect-error query results cannot be selected by callers
  void dataAPI.query<{ n: number }>("SELECT 1");
}

const capabilityFreeModule: NodeModule = {
  createRuntime(host) {
    // @ts-expect-error capability-free modules receive capability-free hosts
    void host.dataAPI;
    return { dispose() {} };
  },
};

function rowSetTypeContract(host: NodeHost<unknown, "data-read" | "row-set-publish">): void {
  void host.dataAPI.publishRowSet;
  // @ts-expect-error row publication exists only under dataAPI
  void host.publishRowSet;
}

describe("truthful host types", () => {
  test("keeps compile-time assertions out of runtime execution", () => {
    expect(typeContract).toBeFunction();
    expect(rowSetTypeContract).toBeFunction();
    expect(capabilityFreeModule.createRuntime).toBeFunction();
  });
});
