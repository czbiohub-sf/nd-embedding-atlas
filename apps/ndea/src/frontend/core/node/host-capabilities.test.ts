import { describe, expect, test } from "bun:test";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { z } from "zod";
import type { ErasedAppNodeHost } from "./app-node-host";
import { assertNodeHostCapabilities } from "./host-capabilities";

const definition = defineNode({
  ref: exactNodeTypeRef("capability-fixture", "1.0.0"),
  title: "Capability fixture",
  role: "view",
  inputs: [],
  outputs: [],
  capabilities: ["data-read", "focus-coordination"] as const,
  config: {
    version: nodeConfigVersion(1),
    schema: z.object({}),
    defaultValue: {},
  },
});

function erasedHostTypeContract(host: ErasedAppNodeHost): void {
  // @ts-expect-error erased hosts expose no unvalidated capability services
  void host.dataAPI;
  // @ts-expect-error erased hosts expose no unvalidated coordination services
  void host.focus;
}

function erasedHost(value: object): ErasedAppNodeHost {
  return value as unknown as ErasedAppNodeHost;
}

describe("node host capability assertion", () => {
  test("rejects declared memberships with missing required services", () => {
    const host = erasedHost({
      capabilities: new Set(["data-read", "focus-coordination"]),
    });
    expect(() => assertNodeHostCapabilities(definition, host)).toThrow("data-read.data must be object");
  });

  test("rejects malformed callable services", () => {
    const host = erasedHost({
      capabilities: new Set(["data-read", "focus-coordination"]),
      data: {},
      registerClient() {},
      inputPredicate: {},
      dataAPI: { query: "not callable" },
      focus: { get() {}, set() {} },
    });
    expect(() => assertNodeHostCapabilities(definition, host)).toThrow("data-read.dataAPI.query must be callable");
  });

  test("names every missing capability before Body mount", () => {
    const host = erasedHost({ capabilities: new Set(["data-read"]) });
    expect(() => assertNodeHostCapabilities(definition, host)).toThrow(
      "node host for capability-fixture@1.0.0 is missing capabilities: focus-coordination",
    );
  });

  test("keeps erased-host compile-time assertions out of runtime execution", () => {
    expect(erasedHostTypeContract).toBeFunction();
  });
});
