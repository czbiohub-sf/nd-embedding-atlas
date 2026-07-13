import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
  PluginManifestSchema,
  SDK_VERSION,
  type NodeDefinition,
  type NodeModule,
  type PluginAPI,
  type PluginFactory,
} from "@ndea/sdk";

const transformDefinition = defineNode({
  ref: exactNodeTypeRef("example/transform", "1.0.0"),
  title: "Example transform",
  role: "transform",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: ["data-read", "predicate-publish", "compute"] as const,
  config: {
    schema: z.object({ threshold: z.number() }),
    version: nodeConfigVersion(1),
    defaultValue: { threshold: 0 },
  },
  load: () =>
    Promise.resolve<NodeModule<unknown, "data-read" | "predicate-publish" | "compute">>({
      createRuntime(host) {
        return {
          recompute() {
            host.publishPredicate("transform", null);
          },
          dispose() {},
        };
      },
    }),
});

const mountedViewDefinition = defineNode({
  ref: exactNodeTypeRef("example/view", "1.0.0"),
  title: "Example view",
  role: "view",
  inputs: [{ id: "in", kind: "sel", label: "Rows" }],
  outputs: [{ id: "focus", kind: "focus", label: "Focus" }],
  capabilities: ["focus-coordination"] as const,
  load: () =>
    Promise.resolve<NodeModule<unknown, "focus-coordination">>({
      mountBody(host) {
        const element = document.createElement("div");
        element.dataset.instanceId = host.instanceId;
        let disposed = false;
        return {
          element,
          dispose() {
            if (disposed) return;
            disposed = true;
            element.remove();
          },
        };
      },
    }),
});

describe("canonical plugin SDK barrel", () => {
  test("registers transform and framework-neutral mounted view definitions", async () => {
    const registered: NodeDefinition[] = [];
    const api: PluginAPI = {
      registerNode(definition) {
        registered.push(definition as NodeDefinition);
      },
    };
    const factory: PluginFactory = (pluginAPI) => {
      pluginAPI.registerNode(transformDefinition);
      pluginAPI.registerNode(mountedViewDefinition);
      return () => {};
    };

    const dispose = await factory(api);
    expect(registered.map((definition) => definition.ref.nodeTypeId as string)).toEqual([
      "example/transform",
      "example/view",
    ]);
    expect(registered[1]?.load).toBeFunction();
    expect(dispose).toBeFunction();
    expect(SDK_VERSION as string).toBe("0.1.0");
  });

  test("re-exports the protocol-owned plugin manifest parser", () => {
    const manifest = PluginManifestSchema.parse({
      manifestSchemaVersion: 1,
      pluginId: "example.plugin",
      pluginPackageVersion: "1.2.3",
      sdkVersionRange: "^0.1.0",
      displayName: "Example plugin",
      clientEntry: "dist/client.js",
      staticAssets: ["dist/client.css"],
      hostCompatibility: {
        hostVersionRange: ">=0.1.0",
        platforms: ["darwin", "linux"],
      },
      license: "MIT",
      permissions: [{ permission: "gpu", reason: "Renders a large point cloud" }],
    });

    expect(manifest.permissions[0]?.permission).toBe("gpu");
  });
});
