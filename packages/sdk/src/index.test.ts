import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineDescriptor, defineNode, SDK_VERSION, type NodeDescriptor } from "./index.ts";

interface TestConfig {
  label: string;
}

const descriptor: NodeDescriptor<TestConfig, Record<string, never>> = {
  id: "test-view",
  title: "Test view",
  kind: "view",
  inputs: [],
  outputs: [],
  config: z.object({ label: z.string() }),
  capabilities: new Set(["read"]),
  placement: { container: "docked" },
  instancePolicy: "multi",
  load() {
    return Promise.resolve({
      Component: () => null,
      defaultConfig: { label: "test" },
    });
  },
};

describe("plugin SDK", () => {
  test("stamps descriptors with the package compatibility version", () => {
    const defined = defineDescriptor(descriptor);
    expect(defined.sdkVersion).toBe(SDK_VERSION);
    expect(SDK_VERSION).toBe("0.1.0");
  });

  test("preserves built-in node specializations", () => {
    const node = defineNode({
      id: "test-node",
      title: "Test node",
      inputs: [],
      outputs: [],
      custom: true,
    });
    expect(node.custom).toBe(true);
  });
});
