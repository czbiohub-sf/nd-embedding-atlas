import { describe, expect, test } from "bun:test";
import {
  migrateNodeConfig,
  nodeConfigVersion,
  type DataCapability,
  type NodeCapability,
  type NodeDefinition,
  type PluginAPI,
  type PluginPermission,
} from "@ndea/sdk";
import plugin from "./client";

async function collectDefinitions(): Promise<{
  definitions: readonly NodeDefinition[];
  dispose: () => void;
}> {
  const definitions: NodeDefinition[] = [];
  const api: PluginAPI = {
    registerNode(definition) {
      definitions.push(definition as NodeDefinition);
    },
  };
  const disposer = await plugin(api);
  if (typeof disposer !== "function") throw new Error("Example plugin must return a disposer");
  return { definitions, dispose: disposer };
}

const availabilityContext = {
  hostCapabilities: new Set<NodeCapability>(),
  dataCapabilities: new Set<DataCapability>(),
  grantedPermissions: new Set<PluginPermission>(),
  platform: "darwin" as const,
};

describe("custom-node example", () => {
  test("registers one transform and one mounted view through the public SDK", async () => {
    const { definitions, dispose } = await collectDefinitions();

    expect(definitions.map(({ ref, role }) => [String(ref.nodeTypeId), String(ref.nodeTypeVersion), role])).toEqual([
      ["org.ndea.example/pass-through", "1.0.0", "transform"],
      ["org.ndea.example/greeting", "1.0.0", "view"],
    ]);
    for (const definition of definitions) {
      expect(definition.evaluate).toBeFunction();
      expect(definition.outputs).toHaveLength(1);
    }

    const transform = definitions[0];
    const evaluation = await transform?.evaluate?.(new Map([["in", ["quality > 0.5"]]]), {
      signal: new AbortController().signal,
      epoch: 1,
    });
    expect(evaluation?.get("out")).toBe("quality > 0.5");

    const view = definitions[1];
    const viewEvaluation = await view?.evaluate?.(new Map(), {
      signal: new AbortController().signal,
      epoch: 1,
    });
    expect(viewEvaluation).toEqual(new Map([["out", null]]));
    const module = await view?.load?.();
    expect(typeof module?.mountBody).toBe("function");

    dispose();
    expect(view?.availability?.(availabilityContext)).toEqual({
      available: false,
      reason: "disabled",
      detail: "The plugin session has ended.",
    });
  });

  test("migrates the greeting config before mounting its Body", async () => {
    const { definitions, dispose } = await collectDefinitions();
    const greeting = definitions[1];
    if (!greeting?.config) throw new Error("Greeting config contract is missing");

    expect(
      migrateNodeConfig(greeting.config, {
        version: nodeConfigVersion(1),
        value: { text: "Migrated greeting" },
      }),
    ).toEqual({
      version: nodeConfigVersion(2),
      value: { message: "Migrated greeting", emphasised: false },
    });
    dispose();
  });
});
