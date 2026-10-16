/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineNode, exactNodeTypeRef, type NodeModule } from "@ndea/sdk";

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

describe("node SDK barrel", () => {
  test("defines transform and framework-neutral mounted view definitions", () => {
    const definitions = [transformDefinition, mountedViewDefinition];
    expect(definitions.map((definition) => definition.ref.nodeTypeId as string)).toEqual([
      "example/transform",
      "example/view",
    ]);
    expect(mountedViewDefinition.load).toBeFunction();
  });
});
