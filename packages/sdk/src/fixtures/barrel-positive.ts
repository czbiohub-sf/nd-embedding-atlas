import {
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
  type NodeAvailability,
  type NodeModule,
  type PluginFactory,
} from "@ndea/sdk";
import { z } from "zod";

const availability: NodeAvailability = { available: true };

const factory: PluginFactory = (api) => {
  api.registerNode(
    defineNode({
      ref: exactNodeTypeRef("fixture/transform", "1.0.0"),
      title: "Fixture transform",
      role: "transform",
      inputs: [{ id: "in", kind: "pred", label: "In" }],
      outputs: [{ id: "out", kind: "pred", label: "Out" }],
      capabilities: ["data-read", "predicate-publish"],
      config: {
        schema: z.object({ enabled: z.boolean() }),
        version: nodeConfigVersion(2),
        defaultValue: { enabled: true },
        migrations: [
          {
            from: nodeConfigVersion(1),
            to: nodeConfigVersion(2),
            migrate(config) {
              return config;
            },
          },
        ],
      },
      availability: () => availability,
      load: () =>
        Promise.resolve<NodeModule<unknown, "data-read" | "predicate-publish">>({
          createRuntime(host) {
            return {
              recompute() {
                host.publishPredicate("fixture", null);
              },
              dispose() {},
            };
          },
        }),
    }),
  );
};

export default factory;
