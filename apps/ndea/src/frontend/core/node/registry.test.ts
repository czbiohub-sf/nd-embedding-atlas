import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion, type NodeDefinition } from "@ndea/sdk";
import { loadNodeModule } from "./load-module";
import {
  getDefinition,
  getNode,
  parseConfig,
  registerDefinition,
  registerNode,
  tryRegisterExternalDefinition,
  type AppGraphNodeSpec,
} from "./registry";

function definition(id: string, overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return defineNode({
    ref: exactNodeTypeRef(id, "1.0.0"),
    title: id,
    role: "transform",
    inputs: [],
    outputs: [],
    capabilities: [] as const,
    load: () => Promise.resolve({ createRuntime: () => ({ dispose() {} }) }),
    ...overrides,
  });
}

function graphNode(
  id: string,
  overrides: Partial<AppGraphNodeSpec & { kind: "view" | "transform" }> = {},
): AppGraphNodeSpec & { kind: "view" | "transform" } {
  return {
    id,
    title: id,
    kind: "transform",
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

describe("canonical node registry", () => {
  test("registers one exact definition and loads its framework-neutral module", async () => {
    const value = definition("test-definition-load");
    registerDefinition(value);

    expect(getDefinition("test-definition-load")).toBe(value);
    const module = await loadNodeModule("test-definition-load");
    expect(module.createRuntime).toBeFunction();
    expect("Component" in module).toBe(false);
  });

  test("external registration reports duplicate definitions without replacing the first", () => {
    const first = definition("test-definition-external");
    registerDefinition(first);

    const result = tryRegisterExternalDefinition(definition("test-definition-external"));
    expect(result.ok).toBe(false);
    expect(getDefinition("test-definition-external")).toBe(first);
  });

  test("graph records remain app-local and separate from author definitions", () => {
    const id = "test-definition-separate";
    const graph = graphNode(id);
    const author = definition(id);
    registerNode(graph);
    registerDefinition(author);

    expect(getNode(id)).toBe(graph);
    expect(getDefinition(id)).toBe(author);
  });

  test("author metadata conflicts fail regardless of registration order", () => {
    const graphFirstId = "test-definition-conflict-graph-first";
    registerNode(graphNode(graphFirstId, { title: "Graph title" }));
    expect(() => registerDefinition(definition(graphFirstId, { title: "Author title" }))).toThrow(
      /metadata conflict at "title"/,
    );
    expect(getDefinition(graphFirstId)).toBeUndefined();

    const definitionFirstId = "test-definition-conflict-definition-first";
    registerDefinition(definition(definitionFirstId, { title: "Author title" }));
    expect(() => registerNode(graphNode(definitionFirstId, { title: "Graph title" }))).toThrow(
      /metadata conflict at "title"/,
    );
    expect(getNode(definitionFirstId)).toBeUndefined();
  });

  test("equal author metadata permits app graph registration", () => {
    const id = "test-definition-equal-metadata";
    const ports = [{ id: "in", kind: "pred" as const, label: "In" }];
    registerDefinition(definition(id, { inputs: ports }));
    registerNode(graphNode(id, { inputs: ports }));

    expect(getNode(id)?.inputs).toEqual(ports);
    expect(getDefinition(id)?.inputs).toEqual(ports);
  });

  test("validates persisted config with the supplied schema", () => {
    const schema = z.object({ count: z.number().int() });
    expect(parseConfig({ config: schema }, { count: 2 })).toEqual({ ok: true, value: { count: 2 } });
    expect(parseConfig({ config: schema }, { count: 2.5 }).ok).toBe(false);
    expect(parseConfig({}, { untouched: true })).toEqual({ ok: true, value: { untouched: true } });
  });

  test("definition config owns its version and default independently of graph state", () => {
    const value = definition("test-definition-config", {
      config: {
        schema: z.object({ enabled: z.boolean() }),
        version: nodeConfigVersion(1),
        defaultValue: { enabled: true },
      },
    });
    registerDefinition(value);

    expect(getDefinition("test-definition-config")?.config?.defaultValue).toEqual({ enabled: true });
  });
});
