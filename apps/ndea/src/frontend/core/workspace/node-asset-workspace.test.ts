import { beforeEach, describe, expect, test } from "bun:test";
import type { Metadata } from "@ndea/protocol";
import { exactNodeTypeRef } from "@ndea/sdk";

import { createNativeAppNodeLibrary } from "@/core/node/library";
import {
  createNodeAssetLibrary,
  linkedAssetRef,
  loadUserNodeAssetSource,
  type NodeAssetJsonStorage,
  type NodeAssetLibrary,
} from "@/core/node-asset/library";
import { parseNodeAssetDefinition } from "@/core/node-asset/schema";
import { fromPersistedDoc, loadFromStorage, toPersistedDoc } from "./persist";
import { Workspace } from "./workspace-store";

const native = createNativeAppNodeLibrary();

function workspace(nodeAssets?: NodeAssetLibrary, nodeAssetStorage?: NodeAssetJsonStorage) {
  return new Workspace({
    coordinator: { query: () => Promise.resolve([]) } as never,
    table: "atlas",
    metadata: { dataset_keys: [] } as unknown as Metadata,
    nodeLibrary: native,
    nodeAssets,
    nodeAssetStorage,
  });
}

beforeEach(() => {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  }) as typeof requestAnimationFrame;
});

describe("Workspace node asset authoring", () => {
  test("exposes explicit create/edit UI policy and preserves unresolved outer records intact", () => {
    const authoring = workspace();
    const selected = authoring.addNode("dataset", { x: 0, y: 0 });
    authoring.selectNode(selected);
    authoring.openNodeAssetAuthoring();
    expect(authoring.ui.state.assetAuthoring).toEqual({ mode: "create" });
    authoring.closeNodeAssetAuthoring();
    expect(authoring.ui.state.assetAuthoring).toBeNull();
    authoring.dispose();

    const unresolved = workspace();
    const definitionRef = exactNodeTypeRef("asset/org.example/missing", "1.0.0");
    const state = {
      ...unresolved.store.state,
      nodeAssets: [
        {
          kind: "linked" as const,
          sourceId: "user",
          assetRef: linkedAssetRef("org.example/missing", "1.0.0"),
          nodeTypeRef: definitionRef,
        },
      ],
      nodes: {
        missing: {
          id: "missing",
          definitionRef,
          label: "Missing asset",
          stamp: 42,
        },
      },
      positions: { missing: { x: 10, y: 20 } },
    };
    unresolved.loadDocument(state);
    expect(unresolved.nodeResolution("missing")?.status).toBe("unresolved");
    expect(unresolved.store.state.nodes.missing).toEqual(state.nodes.missing);
    expect(unresolved.store.state.nodeAssets).toEqual(state.nodeAssets);
    const restoredDefinition = parseNodeAssetDefinition({
      schemaVersion: 1,
      assetId: "org.example/missing",
      assetVersion: "1.0.0",
      nodeTypeRef: definitionRef,
      title: "Missing asset",
      dependencies: [],
      nodes: [],
      edges: [],
      inputs: [],
      outputs: [],
      parameters: [],
      documentation: { summary: "Restored" },
      presentation: {},
      visibility: "public",
    });
    unresolved.replaceAvailableNodeAssets(
      createNodeAssetLibrary([
        {
          sourceId: "user",
          kind: "user",
          assets: [restoredDefinition],
          current: { "org.example/missing": "1.0.0" },
        },
      ]),
    );
    expect(unresolved.nodeResolution("missing")?.status).toBe("resolved");
    expect(unresolved.store.state.nodes.missing).toEqual(state.nodes.missing);
    unresolved.dispose();
  });

  test("saves, reopens, edits, and publishes linked exact versions without persisting expansions", () => {
    let bytes: string | null = null;
    const storage: NodeAssetJsonStorage = {
      read: () => bytes,
      replaceAtomically: (value) => {
        bytes = value;
      },
    };
    const first = workspace(undefined, storage);
    const selected = first.addNode("dataset", { x: 10, y: 20 });
    first.selectNode(selected);
    const v1 = first.createNodeAssetDraft({
      assetId: "org.example/dataset",
      assetVersion: "1.0.0",
      title: "Dataset asset",
    });
    const instanceV1 = first.publishNodeAssetDraft(v1, {
      disposition: "linked",
      includeFallback: true,
      position: { x: 300, y: 20 },
    });
    expect(first.store.state.nodes[instanceV1]?.definitionRef).toEqual(v1.nodeTypeRef);
    expect(first.store.state.nodeAssets[0]?.kind).toBe("linked");
    expect(bytes).not.toBeNull();

    const v2 = first.editNodeAssetDefinition(instanceV1, "2.0.0", "Dataset asset v2");
    const instanceV2 = first.publishNodeAssetDraft(v2, {
      disposition: "linked",
      position: { x: 500, y: 20 },
    });
    expect(first.store.state.nodes[instanceV1]?.definitionRef).toEqual(v1.nodeTypeRef);
    expect(first.store.state.nodes[instanceV2]?.definitionRef).toEqual(v2.nodeTypeRef);
    expect(first.nodeLibrary.getCurrentSpec(v1.nodeTypeRef.nodeTypeId)?.definition.ref).toEqual(v2.nodeTypeRef);

    const persisted = toPersistedDoc(first.store.state);
    const canonical = JSON.stringify(persisted);
    expect(canonical).not.toContain("::asset::");
    expect(Object.values(persisted.state.nodes).every((node) => !node.id.includes("::asset::"))).toBe(true);

    const loadedUser = loadUserNodeAssetSource(storage);
    expect(loadedUser.kind).toBe("ok");
    const reopened = workspace(createNodeAssetLibrary([loadedUser.source]), storage);
    const decoded = fromPersistedDoc(persisted, reopened.nodeLibrary);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.errors.join("; "));
    expect(Object.isFrozen(decoded.state.nodeAssets)).toBe(true);
    expect(Object.isFrozen(decoded.state.nodeAssets[0])).toBe(true);
    expect(
      decoded.state.nodeAssets[0]?.kind === "linked" && Object.isFrozen(decoded.state.nodeAssets[0].fallback),
    ).toBe(true);
    reopened.loadDocument(decoded.state);
    expect(reopened.nodeResolution(instanceV1)?.status).toBe("resolved");
    expect(reopened.nodeResolution(instanceV2)?.status).toBe("resolved");
    first.dispose();
    reopened.dispose();
  });

  test("publishes the requested exact version across embedded and linked sources", () => {
    let bytes: string | null = null;
    const storage: NodeAssetJsonStorage = {
      read: () => bytes,
      replaceAtomically: (value) => {
        bytes = value;
      },
    };
    const mixed = workspace(undefined, storage);
    const selected = mixed.addNode("dataset", { x: 0, y: 0 });
    mixed.selectNode(selected);
    const v1 = mixed.createNodeAssetDraft({
      assetId: "org.example/mixed",
      assetVersion: "1.0.0",
      title: "Mixed v1",
    });
    const instanceV1 = mixed.publishNodeAssetDraft(v1, {
      disposition: "embedded",
      position: { x: 200, y: 0 },
    });
    const v2 = mixed.editNodeAssetDefinition(instanceV1, "2.0.0", "Mixed v2");
    const instanceV2 = mixed.publishNodeAssetDraft(v2, {
      disposition: "linked",
      position: { x: 400, y: 0 },
    });
    expect(mixed.store.state.nodes[instanceV1]?.definitionRef).toEqual(v1.nodeTypeRef);
    expect(mixed.store.state.nodes[instanceV2]?.definitionRef).toEqual(v2.nodeTypeRef);
    expect(mixed.nodeLibrary.getCurrentSpec(v2.nodeTypeRef.nodeTypeId)?.definition.ref).toEqual(v2.nodeTypeRef);

    const downgrade = mixed.editNodeAssetDefinition(instanceV2, "1.5.0", "Mixed downgrade");
    expect(() =>
      mixed.publishNodeAssetDraft(downgrade, {
        disposition: "embedded",
        position: { x: 600, y: 0 },
      }),
    ).toThrow(/must be newer than 2.0.0/);
    expect(mixed.nodeLibrary.getCurrentSpec(v2.nodeTypeRef.nodeTypeId)?.definition.ref).toEqual(v2.nodeTypeRef);
    mixed.dispose();
  });

  test("embeds definitions and leaves state unchanged when atomic user storage denies a publish", () => {
    const embedded = workspace();
    const selected = embedded.addNode("dataset", { x: 0, y: 0 });
    embedded.selectNode(selected);
    const draft = embedded.createNodeAssetDraft({
      assetId: "org.example/embedded",
      assetVersion: "1.0.0",
      title: "Embedded",
    });
    const instance = embedded.publishNodeAssetDraft(draft, {
      disposition: "embedded",
      position: { x: 200, y: 0 },
    });
    expect(embedded.store.state.nodeAssets).toEqual([{ kind: "embedded", definition: draft }]);
    expect(embedded.nodeResolution(instance)?.status).toBe("resolved");
    embedded.dispose();

    const denied = workspace(undefined, {
      read: () => null,
      replaceAtomically: () => {
        throw new Error("storage denied");
      },
    });
    const deniedSelected = denied.addNode("dataset", { x: 0, y: 0 });
    denied.selectNode(deniedSelected);
    const deniedDraft = denied.createNodeAssetDraft({
      assetId: "org.example/denied",
      assetVersion: "1.0.0",
      title: "Denied",
    });
    const previousSnapshot = denied.nodeLibrary.assetSnapshot();
    const nodeCount = Object.keys(denied.store.state.nodes).length;
    expect(() =>
      denied.publishNodeAssetDraft(deniedDraft, {
        disposition: "linked",
        position: { x: 200, y: 0 },
      }),
    ).toThrow(/storage denied/);
    expect(Object.keys(denied.store.state.nodes)).toHaveLength(nodeCount);
    expect(denied.store.state.nodeAssets).toEqual([]);
    expect(denied.nodeLibrary.assetSnapshot()).toBe(previousSnapshot);
    expect(denied.addNode("dataset", { x: 400, y: 0 })).toBe("dataset-2");
    denied.dispose();
  });

  test("rejects non-persistent linked publication and does not commit asset snapshots for invalid documents", () => {
    const unavailable = workspace();
    const selected = unavailable.addNode("dataset", { x: 0, y: 0 });
    unavailable.selectNode(selected);
    const draft = unavailable.createNodeAssetDraft({
      assetId: "org.example/persistent",
      assetVersion: "1.0.0",
      title: "Persistent",
    });
    expect(() =>
      unavailable.publishNodeAssetDraft(draft, {
        disposition: "linked",
        position: { x: 200, y: 0 },
      }),
    ).toThrow(/storage is unavailable/);
    expect(unavailable.store.state.nodeAssets).toEqual([]);
    unavailable.dispose();

    const author = workspace();
    const authorSelected = author.addNode("dataset", { x: 0, y: 0 });
    author.selectNode(authorSelected);
    const embedded = author.createNodeAssetDraft({
      assetId: "org.example/temporary",
      assetVersion: "1.0.0",
      title: "Temporary",
    });
    const instance = author.publishNodeAssetDraft(embedded, {
      disposition: "embedded",
      position: { x: 200, y: 0 },
    });
    const persisted = toPersistedDoc(author.store.state);
    const invalid = {
      ...persisted,
      state: {
        ...persisted.state,
        nodes: {
          ...persisted.state.nodes,
          [instance]: {
            ...persisted.state.nodes[instance],
            config: { version: 1, value: { undeclared: true } },
          },
        },
      },
    };
    const reopened = workspace();
    const previousSnapshot = reopened.nodeLibrary.assetSnapshot();
    expect(fromPersistedDoc(invalid, reopened.nodeLibrary).ok).toBe(false);
    expect(reopened.nodeLibrary.assetSnapshot()).toBe(previousSnapshot);
    author.dispose();
    reopened.dispose();
  });

  test("keeps the live snapshot and runtime empty when topology or activation rejects a document", () => {
    const author = workspace();
    const selected = author.addNode("dataset", { x: 0, y: 0 });
    author.selectNode(selected);
    const definition = author.createNodeAssetDraft({
      assetId: "org.example/rejected",
      assetVersion: "1.0.0",
      title: "Rejected",
    });
    const instance = author.publishNodeAssetDraft(definition, {
      disposition: "embedded",
      position: { x: 200, y: 0 },
    });
    const persisted = toPersistedDoc({
      ...author.store.state,
      edges: {
        ...author.store.state.edges,
        bad: {
          id: "bad",
          from: instance,
          fromPort: "missing",
          to: instance,
          toPort: "missing",
          kind: "pred",
        },
      },
    });
    const topologyTarget = workspace();
    const topologySnapshot = topologyTarget.nodeLibrary.assetSnapshot();
    const loaded = loadFromStorage(
      {
        read: () => JSON.stringify(persisted),
        write: () => {
          throw new Error("topology rejection must precede writes");
        },
      },
      "workspace",
      topologyTarget.nodeLibrary,
    );
    expect(loaded.kind).toBe("recovery");
    expect(loaded.kind === "recovery" && loaded.stage).toBe("topology");
    expect(topologyTarget.nodeLibrary.assetSnapshot()).toBe(topologySnapshot);

    const activationTarget = workspace();
    const activationSnapshot = activationTarget.nodeLibrary.assetSnapshot();
    const collisionId = `${instance}::asset::node-1`;
    expect(() =>
      activationTarget.loadDocument({
        ...author.store.state,
        nodes: {
          ...author.store.state.nodes,
          [collisionId]: {
            id: collisionId,
            definitionRef: exactNodeTypeRef("dataset", "1.0.0"),
            label: "Collision",
          },
        },
        positions: {
          ...author.store.state.positions,
          [collisionId]: { x: 400, y: 0 },
        },
      }),
    ).toThrow();
    expect(activationTarget.nodeLibrary.assetSnapshot()).toBe(activationSnapshot);
    expect(activationTarget.store.state.nodes).toEqual({});
    expect(activationTarget.addNode("dataset", { x: 0, y: 0 })).toBe("dataset-1");
    author.dispose();
    topologyTarget.dispose();
    activationTarget.dispose();
  });
});
