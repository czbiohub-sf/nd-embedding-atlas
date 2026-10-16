/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  defineNode,
  exactNodeTypeRef,
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
  capabilities: ["data-read", "compute"],
  config: {
    schema: z.object({ threshold: z.number() }),
    defaultValue: { threshold: 0 },
  },
  load: () =>
    Promise.resolve<NodeModule<unknown, "data-read" | "compute">>({
      createRuntime(host) {
        void host.data.table;
        return { dispose() {} };
      },
    }),
});

const mountedViewDefinition = defineNode({
  ref: exactNodeTypeRef("example/view", "1.0.0"),
  title: "Example view",
  capabilities: ["focus-coordination"],
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
        registered.push(definition);
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
    expect(SDK_VERSION as string).toBe("1.0.0");
  });

  test("re-exports the protocol-owned plugin manifest parser", () => {
    const manifest = PluginManifestSchema.parse({
      manifestSchemaVersion: 1,
      pluginId: "example.plugin",
      pluginPackageVersion: "1.2.3",
      sdkVersionRange: "^1.0.0",
      displayName: "Example plugin",
      clientEntry: "dist/client.js",
      staticAssets: ["dist/client.css"],
      hostCompatibility: {
        hostVersionRange: ">=0.2.0",
        platforms: ["darwin", "linux"],
      },
      license: "MIT",
      permissions: [{ permission: "gpu", reason: "Renders a large point cloud" }],
    });

    expect(manifest.permissions[0]?.permission).toBe("gpu");
  });
});
