import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createNativeWorkspaceNodeLibrary, nativePluginFactory } from "@/core/workspace/definitions";
import { parseWorkspaceNodeConfig, workspaceNodeSpecOf } from "@/core/workspace/node-projection";
import { NATIVE_NODE_CONTRIBUTIONS, NATIVE_NODE_CURRENT_REFS, NATIVE_NODE_DEFINITIONS } from "./native-nodes";
import { collectPluginContribution, NATIVE_NODE_SOURCE } from "@/core/plugin/registration";
import { loadNodeModule } from "./load-module";
import { exactNodeTypeRef } from "@ndea/sdk";

const APP_ROOT = resolve(import.meta.dir, "../../../..");
const nativeNodeLibrary = createNativeWorkspaceNodeLibrary();
const nativeNodeCatalog = nativeNodeLibrary.catalog;

describe("native node catalog fitness functions", () => {
  test("the native factory registers every tuple definition exactly once", async () => {
    const batch = await collectPluginContribution(NATIVE_NODE_SOURCE, nativePluginFactory);
    expect(batch.definitions).toEqual(NATIVE_NODE_DEFINITIONS);
    expect(batch.definitions.map(({ ref }) => String(ref.nodeTypeId))).toEqual([
      "obs",
      "dataset",
      "transform-filter",
      "wrangle",
      "annotate",
      "count",
      "table",
      "scatter",
      "count-plot",
      "histogram",
      "gallery",
      "image-viewer",
      "collection",
      "export",
      "cache",
      "subnet",
      "proxy",
    ]);
    expect(batch.definitions).toHaveLength(NATIVE_NODE_CONTRIBUTIONS.length);
    expect(new Set(batch.definitions.map(({ ref }) => `${ref.nodeTypeId}@${ref.nodeTypeVersion}`)).size).toBe(
      batch.definitions.length,
    );
    expect(nativeNodeCatalog.size).toBe(batch.definitions.length);
  });

  test("every tuple exact ref and current id resolves to its one authoritative definition", () => {
    expect(NATIVE_NODE_CURRENT_REFS).toHaveLength(NATIVE_NODE_CONTRIBUTIONS.length);
    for (const contribution of NATIVE_NODE_CONTRIBUTIONS) {
      const { definition } = contribution;
      expect(nativeNodeCatalog.resolveExact(definition.ref)).toBe(definition);
      expect(nativeNodeCatalog.resolveCurrent(definition.ref.nodeTypeId)).toBe(definition);
      expect(String(definition.ref.nodeTypeVersion)).toBe("1.0.0");
    }
  });

  test("current identities resolve exactly without retired aliases", () => {
    const cache = nativeNodeLibrary.getSpec("cache");
    const imageViewer = nativeNodeLibrary.getSpec("image-viewer");
    expect(cache?.definition.ref).toEqual(exactNodeTypeRef("cache", "1.0.0"));
    expect(imageViewer?.definition.ref).toEqual(exactNodeTypeRef("image-viewer", "1.0.0"));
    expect(nativeNodeLibrary.getDescriptor("image-viewer")?.label).toBe("Image Viewer");
    expect(imageViewer?.definition.inputs).toEqual([{ id: "focus-in", kind: "focus", label: "Focus" }]);
    expect(nativeNodeCatalog.resolveCurrent("selection")).toBeUndefined();
    expect(nativeNodeCatalog.resolveCurrent("fov")).toBeUndefined();
    expect(nativeNodeLibrary.getSpec("selection")).toBeUndefined();
    expect(nativeNodeLibrary.getSpec("fov")).toBeUndefined();
    const paletteTypes = nativeNodeLibrary.paletteDescriptors().map(({ type }) => type);
    expect(paletteTypes).toContain("cache");
    expect(paletteTypes).toContain("image-viewer");
    expect(paletteTypes).not.toContain("selection");
    expect(paletteTypes).not.toContain("fov");
    expect(String(nativeNodeLibrary.getSpec("threshold")?.definition.ref.nodeTypeId)).toBe("transform-filter");
  });

  test("Workspace order and palette are tuple-derived without a second list", () => {
    const tupleSpecs = NATIVE_NODE_CONTRIBUTIONS.map(workspaceNodeSpecOf);
    expect(nativeNodeLibrary.listSpecs().map(({ type }) => type)).toEqual(tupleSpecs.map(({ type }) => type));
    expect(nativeNodeLibrary.paletteDescriptors().map(({ type }) => type)).toEqual(
      tupleSpecs.filter(({ inPalette }) => inPalette).map(({ type }) => type),
    );
  });

  test("native graph and presentation policy is deeply frozen at the core/node boundary", () => {
    for (const contribution of NATIVE_NODE_CONTRIBUTIONS) {
      expect(Object.isFrozen(contribution)).toBe(true);
      expect(Object.isFrozen(contribution.graph)).toBe(true);
      expect(Object.isFrozen(contribution.presentation)).toBe(true);
      expect(Object.isFrozen(contribution.presentation.geometry)).toBe(true);
      expect(Object.isFrozen(contribution.presentation.geometry.card)).toBe(true);
      expect(Object.isFrozen(contribution.presentation.geometry.full)).toBe(true);
      expect("Body" in contribution.graph).toBe(false);
      expect("usesDefinitionModule" in contribution.graph).toBe(false);
    }
  });

  test("definition metadata is authoritative while graph runtime and layout stay app-local", () => {
    for (const spec of nativeNodeLibrary.listSpecs()) {
      expect(nativeNodeCatalog.resolveExact(spec.definition.ref)).toBe(spec.definition);
      expect(nativeNodeLibrary.getDescriptor(spec.type)?.label).toBe(spec.definition.title);
      expect(spec.cook).toBeFunction();
      expect(spec.geometry.card.w).toBeGreaterThan(0);
      expect(spec.pluginId).toBe(spec.definition.load ? spec.definition.ref.nodeTypeId : null);
      if (spec.definition.load) expect(spec.body).toBeDefined();
      else expect(spec.body).toBeUndefined();
    }
  });

  test("Scatter, charts, Table, Annotate, and Image Viewer preserve characterized ports and metadata", () => {
    const characterized = {
      scatter: {
        role: "view",
        inputs: [["in", "pred"]],
        outputs: [["out", "sel"]],
        icon: "scatter-chart",
      },
      "count-plot": {
        role: "view",
        inputs: [["in", "pred"]],
        outputs: [["out", "sel"]],
        icon: "bar-chart",
      },
      histogram: {
        role: "view",
        inputs: [["in", "pred"]],
        outputs: [["out", "sel"]],
        icon: "bar-chart",
      },
      table: {
        role: "view",
        inputs: [["in", "pred"]],
        outputs: [["out", "focus"]],
        icon: "table",
      },
      annotate: {
        role: "view",
        inputs: [["in", "pred"]],
        outputs: [["out", "focus"]],
        icon: "tag",
      },
      "image-viewer": {
        role: "view",
        inputs: [["focus-in", "focus"]],
        outputs: [],
        icon: "image",
      },
    } as const;

    for (const [nodeTypeId, expected] of Object.entries(characterized)) {
      const definition = nativeNodeCatalog.resolveCurrent(nodeTypeId);
      expect(definition, `${nodeTypeId} definition missing`).toBeDefined();
      expect(definition?.role).toBe(expected.role);
      expect(definition?.inputs.map(({ id, kind }) => [id, kind])).toEqual(
        expected.inputs.map(([portId, kind]) => [portId, kind]),
      );
      expect(definition?.outputs.map(({ id, kind }) => [id, kind])).toEqual(
        expected.outputs.map(([portId, kind]) => [portId, kind]),
      );
      expect(definition?.presentation?.icon).toBe(expected.icon);
    }
    expect(nativeNodeCatalog.resolveCurrent("scatter")?.documentation?.summary).toContain("embedding");
    expect(nativeNodeCatalog.resolveCurrent("table")?.documentation?.summary).toContain("rows");
    expect(nativeNodeCatalog.resolveCurrent("image-viewer")?.dataRequirements).toEqual(["plate-image"]);
  });

  test("every native Body policy resolves a framework-neutral mount", async () => {
    const bodyContributions = NATIVE_NODE_CONTRIBUTIONS.filter(({ presentation }) => presentation.body !== undefined);
    expect(bodyContributions.length).toBeGreaterThan(0);
    for (const contribution of bodyContributions) {
      const module = await loadNodeModule(nativeNodeCatalog, contribution.definition.ref);
      expect(module.mountBody, `${contribution.definition.ref.nodeTypeId} has no Body mount`).toBeFunction();
      expect("Component" in module, `${contribution.definition.ref.nodeTypeId} leaked a framework component`).toBe(
        false,
      );
    }
  });

  test("Scatter declares every optional host service used by its Body and routing", () => {
    const capabilities = new Set(nativeNodeCatalog.resolveCurrent("scatter")?.capabilities);
    for (const capability of [
      "focus-coordination",
      "view-coordination",
      "predicate-publish",
      "row-set-publish",
      "row-set-subscribe",
      "gpu-device",
    ] as const) {
      expect(capabilities.has(capability), `Scatter is missing ${capability}`).toBe(true);
    }
  });

  test("every config contract accepts its tuple-defined default", () => {
    for (const spec of nativeNodeLibrary.listSpecs()) {
      const config = spec.definition.config;
      if (!config) continue;
      expect(config.schema.safeParse(config.defaultValue).success, `${spec.type} rejects its default config`).toBe(
        true,
      );
      expect(parseWorkspaceNodeConfig(spec, config.defaultValue).ok, `${spec.type} rejects its default config`).toBe(
        true,
      );
    }
  });

  test("no node-type dispatch switch remains", () => {
    const hits: string[] = [];
    for (const file of new Glob("src/frontend/**/*.{ts,tsx}").scanSync(APP_ROOT)) {
      if (file.includes(".test.")) continue;
      const count =
        readFileSync(join(APP_ROOT, file), "utf8").match(/switch\s*\(\s*(node|def)\.type\s*\)/g)?.length ?? 0;
      if (count) hits.push(`${file} (${count})`);
    }
    expect(hits).toEqual([]);
  });
});
