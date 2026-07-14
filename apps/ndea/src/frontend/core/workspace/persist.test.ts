import { describe, expect, test } from "bun:test";
import { defineNode, exactNodeTypeRef, nodeConfigVersion, rowIndex } from "@ndea/sdk";

import { createNativeAppNodeLibrary } from "@/core/node/library";
import type { AppNodeLibrary } from "@/core/node/library";
import { createNodeCatalog } from "@/core/plugin/catalog";
import { NATIVE_NODE_SOURCE } from "@/core/plugin/registration";
import type { WorkspaceDocumentState } from "./types";
import { DOC_VERSION, fromPersistedDoc, migrate, toPersistedDoc, validateDoc } from "./persist";

const library = createNativeAppNodeLibrary();

function emptyState(): WorkspaceDocumentState {
  return {
    nodeAssets: [],
    nodes: {},
    edges: {},
    positions: {},
    sizeOverrides: {},
    formOverride: {},
    formLocked: {},
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedEdgeId: null,
    explicit: {},
    stageTree: null,
    disposition: "strip",
    stripH: 280,
    claimed: null,
    graphPath: null,
    flags: {},
    coordinationScopes: {},
    coordinationSpace: {},
  };
}

function legacyV2(type: string, config?: unknown) {
  const state = {
    ...emptyState(),
    nodes: {
      n1: {
        id: "n1",
        type,
        kind: "transform",
        label: "Authored",
        pluginId: null,
        ...(config === undefined ? {} : { config }),
      },
    },
    selection: "n1",
    selSet: ["n1"],
    selectedEdge: null,
    coordinationSpace: { focus: { A: "8" } },
  } as Record<string, unknown>;
  delete state.selectedNodeId;
  delete state.selectedNodeIds;
  delete state.selectedEdgeId;
  return { version: 2, state };
}

describe("workspace v5 document schema", () => {
  test("serializes the canonical v5 runtime boundary", () => {
    const state = emptyState();
    state.nodes.n1 = {
      id: "n1",
      definitionRef: exactNodeTypeRef("dataset", "1.0.0"),
      label: "Dataset",
      config: { version: nodeConfigVersion(1), value: { datasetKey: null } },
    };
    state.coordinationSpace = { focus: { A: rowIndex(3), B: null } };
    const document = toPersistedDoc(state);
    expect(document.version).toBe(DOC_VERSION);
    expect(document.state.coordinationSpace).toEqual({ focus: { A: rowIndex(3), B: null } });
    expect(fromPersistedDoc(document, library)).toEqual({ ok: true, state });
  });

  test("strict validation rejects copied provenance and legacy editor fields", () => {
    const document = toPersistedDoc(emptyState()) as unknown as { version: 5; state: Record<string, unknown> };
    document.state.selection = null;
    expect(validateDoc(document, library).ok).toBe(false);

    const withNode = toPersistedDoc(emptyState()) as unknown as { version: 5; state: Record<string, unknown> };
    withNode.state.nodes = {
      n1: {
        id: "n1",
        definitionRef: { nodeTypeId: "dataset", nodeTypeVersion: "1.0.0" },
        label: "Dataset",
        type: "dataset",
      },
    };
    expect(validateDoc(withNode, library).ok).toBe(false);
  });

  test("rejects malformed numeric focus indices", () => {
    const document = toPersistedDoc(emptyState()) as unknown as { version: 5; state: Record<string, unknown> };
    document.state.coordinationSpace = { focus: { A: "8" } };
    expect(validateDoc(document, library).ok).toBe(false);
  });

  test("reserves deterministic asset expansion ids for runtime-only nodes", () => {
    const state = emptyState();
    const id = "outer::asset::node-1";
    state.nodes[id] = {
      id,
      definitionRef: exactNodeTypeRef("dataset", "1.0.0"),
      label: "Collision",
    };
    expect(() => toPersistedDoc(state)).toThrow(/reserved runtime namespace/);
  });
});

describe("pure step migrations", () => {
  test("v1 first migrates coordination and then exact v5 identity", () => {
    const v2 = legacyV2("dataset", { dataset: "plate-a" });
    const v1 = structuredClone(v2);
    v1.version = 1;
    v1.state.syncGroups = { n1: "A" };
    v1.state.groupFocus = { A: "8" };
    delete v1.state.coordinationScopes;
    delete v1.state.coordinationSpace;

    const migrated = migrate(v1, library);
    expect(migrated.state.coordinationScopes).toEqual({ n1: { focus: "A" } });
    expect(migrated.state.coordinationSpace).toEqual({ focus: { A: rowIndex(8) } });
    expect(migrated.state.nodes.n1).toEqual({
      id: "n1",
      definitionRef: exactNodeTypeRef("dataset", "1.0.0"),
      label: "Authored",
      config: { version: nodeConfigVersion(1), value: { datasetKey: "plate-a" } },
    });
  });

  test.each([
    ["obs", exactNodeTypeRef("obs", "1.0.0")],
    ["dataset", exactNodeTypeRef("dataset", "1.0.0")],
    ["selection", exactNodeTypeRef("cache", "1.0.0")],
    ["fov", exactNodeTypeRef("image-viewer", "1.0.0")],
    ["threshold", exactNodeTypeRef("transform-filter", "1.0.0")],
    ["transform-filter", exactNodeTypeRef("transform-filter", "1.0.0")],
    ["wrangle", exactNodeTypeRef("wrangle", "1.0.0")],
    ["annotate", exactNodeTypeRef("annotate", "1.0.0")],
    ["count", exactNodeTypeRef("count", "1.0.0")],
    ["table", exactNodeTypeRef("table", "1.0.0")],
    ["scatter", exactNodeTypeRef("scatter", "1.0.0")],
    ["count-plot", exactNodeTypeRef("count-plot", "1.0.0")],
    ["histogram", exactNodeTypeRef("histogram", "1.0.0")],
    ["gallery", exactNodeTypeRef("gallery", "1.0.0")],
    ["image-viewer", exactNodeTypeRef("image-viewer", "1.0.0")],
    ["collection", exactNodeTypeRef("collection", "1.0.0")],
    ["export", exactNodeTypeRef("export", "1.0.0")],
    ["cache", exactNodeTypeRef("cache", "1.0.0")],
    ["subnet", exactNodeTypeRef("subnet", "1.0.0")],
    ["proxy", exactNodeTypeRef("proxy", "1.0.0")],
  ])("maps retired v2 type %s explicitly", (legacyType, targetRef) => {
    const document = legacyV2(legacyType);
    const migrated = migrate(document, library);
    expect(migrated.state.nodes.n1.definitionRef).toEqual(targetRef);
  });

  test("migrates v1 and v2 documents with no focus coordination cells", () => {
    const v2 = legacyV2("dataset");
    v2.state.coordinationSpace = {};
    expect(migrate(v2, library).state.coordinationSpace).toEqual({});

    const v1 = structuredClone(v2);
    v1.version = 1;
    delete v1.state.coordinationSpace;
    v1.state.syncGroups = {};
    v1.state.groupFocus = {};
    expect(migrate(v1, library).state.coordinationSpace).toEqual({});
  });

  test("v2 migration remains pinned to 1.0.0 when a second current version exists", () => {
    const v1 = library.catalog.resolveExact(exactNodeTypeRef("dataset", "1.0.0"))!;
    const v2 = defineNode({
      ref: exactNodeTypeRef("dataset", "2.0.0"),
      title: "Future dataset",
      role: "transform",
      inputs: [],
      outputs: [{ id: "out", kind: "pred", label: "Out" }],
      capabilities: [] as const,
    });
    const catalog = createNodeCatalog([{ source: NATIVE_NODE_SOURCE, definitions: [v1, v2] }]);
    const versionedLibrary = {
      ...library,
      catalog,
      getSpecExact: (ref: Parameters<AppNodeLibrary["getSpecExact"]>[0]) => library.getSpecExact(ref),
    } satisfies AppNodeLibrary;

    expect(catalog.resolveCurrent("dataset")?.ref).toEqual(v2.ref);
    expect(migrate(legacyV2("dataset"), versionedLibrary).state.nodes.n1.definitionRef).toEqual(v1.ref);
  });

  test.each([
    ["dataset", {}, { datasetKey: null }],
    ["collection", { collectionId: "saved" }, { collectionId: "saved", collectionName: null, collectionVersion: null }],
    ["image-viewer", {}, { datasetKey: null }],
  ])("normalizes legacy %s config against complete defaults", (nodeTypeId, config, expected) => {
    const migrated = migrate(legacyV2(nodeTypeId, config), library);
    expect(migrated.state.nodes.n1.config).toEqual({
      version: nodeConfigVersion(1),
      value: expected,
    });
  });

  test("dispatches every native v2 config through an explicit version 0 adapter", () => {
    for (const spec of library.listSpecs()) {
      const contract = spec.definition.config;
      if (!contract || spec.source.kind !== "native") continue;
      const nodeTypeId =
        spec.definition.ref.nodeTypeId === "transform-filter" ? "threshold" : spec.definition.ref.nodeTypeId;
      const migrated = migrate(legacyV2(nodeTypeId, contract.defaultValue), library);
      expect(migrated.state.nodes.n1.config?.version).toBe(contract.version);
      expect(contract.schema.safeParse(migrated.state.nodes.n1.config?.value).success).toBe(true);
    }
  });

  test("detects object-key/id collisions without mutating input", () => {
    const document = legacyV2("dataset");
    (document.state.nodes as Record<string, { id: string }>).n1.id = "other";
    const before = structuredClone(document);
    expect(() => migrate(document, library)).toThrow("collision");
    expect(document).toEqual(before);
  });

  test("a current document migration is equal but never aliases mutable input", () => {
    const document = toPersistedDoc(emptyState());
    const migrated = migrate(document, library);
    expect(migrated).toEqual(document);
    expect(migrated).not.toBe(document);
  });
});
