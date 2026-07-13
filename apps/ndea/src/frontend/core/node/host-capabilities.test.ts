import { describe, expect, test } from "bun:test";
import { defineNode, exactNodeTypeRef, nodeConfigVersion, type NodeHost } from "@ndea/sdk";
import { z } from "zod";
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

describe("node host capability assertion", () => {
  test("accepts a host with every declared capability", () => {
    const host = {
      capabilities: new Set(["data-read", "focus-coordination"]),
    } as unknown as NodeHost;
    expect(() => assertNodeHostCapabilities(definition, host)).not.toThrow();
  });

  test("names every missing capability before Body mount", () => {
    const host = { capabilities: new Set(["data-read"]) } as unknown as NodeHost;
    expect(() => assertNodeHostCapabilities(definition, host)).toThrow(
      "node host for capability-fixture@1.0.0 is missing capabilities: focus-coordination",
    );
  });
});
