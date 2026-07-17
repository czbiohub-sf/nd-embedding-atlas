import { describe, expect, test } from "bun:test";
import { exactNodeTypeRef, nodeConfigVersion, rowIndex } from "@ndea/sdk";
import { z } from "zod";

import { createNativeAppNodeLibrary, type AppNodeLibrary, type AppNodeSpec } from "@/core/node/library";
import type { WorkspaceDocumentState } from "./types";
import { loadFromStorage, saveToStorage, storageKey, toPersistedDoc, type WorkspaceStorage } from "./persist";

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

class MemoryStorage implements WorkspaceStorage {
  readonly bytes: Record<string, string>;
  readonly writes: string[] = [];
  failRead: ((key: string) => Error | null) | null = null;
  failWrite: ((key: string) => Error | null) | null = null;

  constructor(initial: Record<string, string> = {}) {
    this.bytes = { ...initial };
  }

  read(key: string): string | null {
    const error = this.failRead?.(key);
    if (error) throw error;
    return this.bytes[key] ?? null;
  }

  write(key: string, value: string): void {
    const error = this.failWrite?.(key);
    if (error) throw error;
    this.writes.push(key);
    this.bytes[key] = value;
  }
}

function legacyV2() {
  const state = {
    ...emptyState(),
    nodes: {
      dataset: {
        id: "dataset",
        type: "dataset",
        kind: "source",
        label: "Dataset",
        pluginId: null,
        config: {},
      },
    },
    selection: "dataset",
    selSet: ["dataset"],
    selectedEdge: null,
    coordinationSpace: { focus: { A: "8" } },
  } as Record<string, unknown>;
  delete state.selectedNodeId;
  delete state.selectedNodeIds;
  delete state.selectedEdgeId;
  return { version: 2, state };
}

describe("WorkspaceStorage recovery contract", () => {
  test("migrates a stale v5 Image Viewer port instead of opening recovery", () => {
    const state = emptyState();
    state.nodes.table = {
      id: "table",
      definitionRef: exactNodeTypeRef("table", "1.0.0"),
      label: "Table",
    };
    state.nodes.viewer = {
      id: "viewer",
      definitionRef: exactNodeTypeRef("image-viewer", "1.0.0"),
      label: "Image Viewer",
    };
    state.edges.e5 = {
      id: "e5",
      from: "table",
      fromPort: "out",
      to: "viewer",
      toPort: "in",
      kind: "focus",
    };
    const stale = structuredClone(toPersistedDoc(state)) as unknown as {
      version: number;
      state: WorkspaceDocumentState;
    };
    stale.version = 5;
    const raw = JSON.stringify(stale);
    const storage = new MemoryStorage({ active: raw });

    const loaded = loadFromStorage(storage, "active", library);

    expect(loaded).toMatchObject({
      kind: "ok",
      state: { edges: { e5: { toPort: "focus-in" } } },
    });
    expect(storage.bytes["active.backup.v5"]).toBe(raw);
    expect(JSON.parse(storage.bytes.active).version).toBe(6);
  });

  test("migrates the retired Image Viewer input port before topology validation", () => {
    const state = emptyState();
    state.nodes.table = {
      id: "table",
      definitionRef: exactNodeTypeRef("table", "1.0.0"),
      label: "Table",
    };
    state.nodes.viewer = {
      id: "viewer",
      definitionRef: exactNodeTypeRef("image-viewer", "1.0.0"),
      label: "Image Viewer",
    };
    state.edges.e5 = {
      id: "e5",
      from: "table",
      fromPort: "out",
      to: "viewer",
      toPort: "in",
      kind: "focus",
    };
    const legacy = structuredClone(toPersistedDoc(state)) as unknown as {
      version: number;
      state: WorkspaceDocumentState;
    };
    legacy.version = 4;
    const raw = JSON.stringify(legacy);
    const storage = new MemoryStorage({ active: raw });

    const loaded = loadFromStorage(storage, "active", library);

    expect(loaded).toMatchObject({
      kind: "ok",
      state: { edges: { e5: { toPort: "focus-in" } } },
    });
    expect(storage.bytes["active.backup.v4"]).toBe(raw);
    expect(JSON.parse(storage.bytes.active).version).toBe(6);
  });

  test("migrates v3 edges to explicit exact output ports and preserves the verified backup", () => {
    const state = emptyState();
    state.nodes.dataset = {
      id: "dataset",
      definitionRef: exactNodeTypeRef("dataset", "1.0.0"),
      label: "Dataset",
    };
    state.nodes.count = {
      id: "count",
      definitionRef: exactNodeTypeRef("count", "1.0.0"),
      label: "Count",
    };
    state.edges.e1 = {
      id: "e1",
      from: "dataset",
      fromPort: "out",
      to: "count",
      toPort: "in",
      kind: "pred",
    };
    const legacy = structuredClone(toPersistedDoc(state)) as unknown as {
      version: number;
      state: Record<string, unknown> & { edges: Record<string, Record<string, unknown>> };
    };
    legacy.version = 3;
    delete legacy.state.nodeAssets;
    delete legacy.state.edges.e1.fromPort;
    const raw = JSON.stringify(legacy);
    const storage = new MemoryStorage({ active: raw });

    const loaded = loadFromStorage(storage, "active", library);

    expect(loaded.kind).toBe("ok");
    if (loaded.kind !== "ok") throw new Error(loaded.kind);
    const datasetOutput = library.getSpecExact(exactNodeTypeRef("dataset", "1.0.0"))?.definition.outputs[0]?.id;
    if (!datasetOutput) throw new Error("dataset output unavailable");
    expect(loaded.state.edges.e1?.fromPort).toBe(datasetOutput);
    expect(storage.bytes["active.backup.v3"]).toBe(raw);
    expect(JSON.parse(storage.bytes.active).version).toBe(6);
  });

  test("multiple session keys never cross-read or cross-write", () => {
    const storage = new MemoryStorage();
    const first = emptyState();
    first.selectedNodeId = "first";
    const second = emptyState();
    second.selectedNodeId = "second";
    saveToStorage(storage, storageKey("dataset-a"), first);
    saveToStorage(storage, storageKey("dataset-b"), second);
    expect(loadFromStorage(storage, storageKey("dataset-a"), library)).toMatchObject({
      kind: "ok",
      state: { selectedNodeId: "first" },
    });
    expect(loadFromStorage(storage, storageKey("dataset-b"), library)).toMatchObject({
      kind: "ok",
      state: { selectedNodeId: "second" },
    });
  });

  test("only a confirmed null read reports miss", () => {
    const storage = new MemoryStorage();
    expect(loadFromStorage(storage, "active", library)).toEqual({ kind: "miss" });
    storage.failRead = () => new Error("read denied");
    expect(loadFromStorage(storage, "active", library)).toMatchObject({
      kind: "recovery",
      stage: "read",
      errors: ["read denied"],
    });
  });

  test("invalid JSON and future documents preserve active bytes", () => {
    const invalid = "{bad";
    const storage = new MemoryStorage({ active: invalid });
    expect(loadFromStorage(storage, "active", library)).toMatchObject({ kind: "recovery", stage: "parse" });
    expect(storage.bytes.active).toBe(invalid);
    expect(storage.writes).toEqual([]);

    const future = JSON.stringify({ version: 99, state: {} });
    storage.bytes.active = future;
    expect(loadFromStorage(storage, "active", library)).toMatchObject({ kind: "recovery", stage: "version" });
    expect(storage.bytes.active).toBe(future);
    expect(storage.writes).toEqual([]);

    const unknownLegacy = legacyV2();
    (unknownLegacy.state.nodes as Record<string, { type: string }>).dataset.type = "removed-without-map";
    const unknownRaw = JSON.stringify(unknownLegacy);
    storage.bytes.active = unknownRaw;
    expect(loadFromStorage(storage, "active", library)).toMatchObject({
      kind: "recovery",
      stage: "migration",
    });
    expect(storage.bytes.active).toBe(unknownRaw);
    expect(storage.writes).toEqual([]);
  });

  test("migration writes raw source bytes to a versioned backup before canonical active bytes", () => {
    const raw = JSON.stringify(legacyV2());
    const storage = new MemoryStorage({ active: raw });
    const loaded = loadFromStorage(storage, "active", library);
    expect(loaded.kind).toBe("ok");
    expect(storage.writes).toEqual(["active.backup.v2", "active"]);
    expect(storage.bytes["active.backup.v2"]).toBe(raw);
    expect(JSON.parse(storage.bytes.active)).toMatchObject({
      version: 6,
      state: {
        selectedNodeId: "dataset",
        selectedNodeIds: ["dataset"],
        coordinationSpace: { focus: { A: 8 } },
      },
    });
    expect(storage.bytes.active).not.toContain('"type"');
    expect(storage.bytes.active).not.toContain('"kind":"source"');
    expect(storage.bytes.active).not.toContain('"pluginId"');
    expect(storage.bytes.active).not.toContain('"selection"');
  });

  test("denied backup verification exposes validated read-only state and preserves active bytes", () => {
    const raw = JSON.stringify(legacyV2());
    const storage = new MemoryStorage({ active: raw });
    storage.failRead = (key) => (key.endsWith(".backup.v2") ? new Error("backup read denied") : null);
    const loaded = loadFromStorage(storage, "active", library);
    expect(loaded).toMatchObject({
      kind: "recovery",
      stage: "backup-verify",
      backupKey: "active.backup.v2",
      state: { selectedNodeId: "dataset" },
    });
    expect(storage.bytes.active).toBe(raw);
  });

  test("interrupted canonical rewrite exposes validated state and preserves active bytes", () => {
    const raw = JSON.stringify(legacyV2());
    const storage = new MemoryStorage({ active: raw });
    storage.failWrite = (key) => (key === "active" ? new Error("rewrite interrupted") : null);
    const loaded = loadFromStorage(storage, "active", library);
    expect(loaded).toMatchObject({
      kind: "recovery",
      stage: "rewrite",
      backupKey: "active.backup.v2",
      state: { selectedNodeId: "dataset" },
    });
    expect(storage.bytes.active).toBe(raw);
    expect(storage.bytes["active.backup.v2"]).toBe(raw);
  });

  test("unresolved exact definitions and opaque configs round-trip without validation", () => {
    const state = emptyState();
    state.nodes.missing = {
      id: "missing",
      definitionRef: exactNodeTypeRef("plugin.example/missing", "7.0.1"),
      label: "Unavailable",
      parent: "subnet",
      config: { version: nodeConfigVersion(44), value: { future: true } },
    };
    state.nodes.subnet = {
      id: "subnet",
      definitionRef: exactNodeTypeRef("subnet", "1.0.0"),
      label: "Authored subnet",
    };
    state.nodes.dataset = {
      id: "dataset",
      definitionRef: exactNodeTypeRef("dataset", "1.0.0"),
      label: "Dataset",
      config: { version: nodeConfigVersion(1), value: { datasetKey: null } },
    };
    state.edges.edge = { id: "edge", from: "dataset", fromPort: "out", to: "missing", toPort: "in", kind: "pred" };
    state.positions.missing = { x: 10, y: 20 };
    state.sizeOverrides.missing = { card: { w: 310, h: 190 }, full: { w: 700, h: 420 } };
    state.formOverride.missing = "full";
    state.formLocked.missing = true;
    state.explicit.missing = "staged";
    state.stageTree = { dir: "row", ratio: 0.4, a: "missing", b: "dataset" };
    state.disposition = "hidden";
    state.stripH = 333;
    state.claimed = "missing";
    state.graphPath = "subnet";
    state.flags.missing = { off: true };
    state.selectedNodeId = "missing";
    state.selectedNodeIds = ["missing", "dataset"];
    state.selectedEdgeId = "edge";
    state.coordinationScopes.missing = { focus: "A" };
    state.coordinationSpace.focus = { A: rowIndex(2) };

    const storage = new MemoryStorage();
    saveToStorage(storage, "active", state);
    expect(loadFromStorage(storage, "active", library)).toEqual({ kind: "ok", state });
  });

  test("invalid known config enters config recovery and does not rewrite", () => {
    const state = emptyState();
    state.nodes.dataset = {
      id: "dataset",
      definitionRef: exactNodeTypeRef("dataset", "1.0.0"),
      label: "Dataset",
      config: { version: nodeConfigVersion(1), value: { datasetKey: 4 } },
    };
    const raw = JSON.stringify(toPersistedDoc(state));
    const storage = new MemoryStorage({ active: raw });
    expect(loadFromStorage(storage, "active", library)).toMatchObject({ kind: "recovery", stage: "config" });
    expect(storage.bytes.active).toBe(raw);
    expect(storage.writes).toEqual([]);
  });

  test("v2 and v3 resolved cycles enter topology recovery before backup or rewrite", () => {
    const state = emptyState();
    state.nodes.a = {
      id: "a",
      definitionRef: exactNodeTypeRef("proxy", "1.0.0"),
      label: "A",
    };
    state.nodes.b = {
      id: "b",
      definitionRef: exactNodeTypeRef("proxy", "1.0.0"),
      label: "B",
    };
    state.edges.forward = { id: "forward", from: "a", fromPort: "out", to: "b", toPort: "in", kind: "pred" };
    state.edges.reverse = { id: "reverse", from: "b", fromPort: "out", to: "a", toPort: "in", kind: "pred" };

    const v4Raw = JSON.stringify(toPersistedDoc(state));
    const v4Storage = new MemoryStorage({ active: v4Raw });
    expect(loadFromStorage(v4Storage, "active", library)).toMatchObject({
      kind: "recovery",
      stage: "topology",
      state: { edges: state.edges },
    });
    expect(v4Storage.bytes.active).toBe(v4Raw);
    expect(v4Storage.writes).toEqual([]);

    const legacyState = {
      ...state,
      nodes: {
        a: { id: "a", type: "proxy", kind: "transform", label: "A", pluginId: null },
        b: { id: "b", type: "proxy", kind: "transform", label: "B", pluginId: null },
      },
      selection: null,
      selSet: [],
      selectedEdge: null,
      coordinationSpace: {},
    } as Record<string, unknown>;
    delete legacyState.selectedNodeId;
    delete legacyState.selectedNodeIds;
    delete legacyState.selectedEdgeId;
    const v2Raw = JSON.stringify({ version: 2, state: legacyState });
    const v2Storage = new MemoryStorage({ active: v2Raw });
    expect(loadFromStorage(v2Storage, "active", library)).toMatchObject({
      kind: "recovery",
      stage: "topology",
      state: { edges: state.edges },
    });
    expect(v2Storage.bytes.active).toBe(v2Raw);
    expect(v2Storage.writes).toEqual([]);
  });

  test("malformed edge endpoints, ports, and kinds recover before any write", () => {
    const state = emptyState();
    state.nodes.dataset = {
      id: "dataset",
      definitionRef: exactNodeTypeRef("dataset", "1.0.0"),
      label: "Dataset",
    };
    state.nodes.count = {
      id: "count",
      definitionRef: exactNodeTypeRef("count", "1.0.0"),
      label: "Count",
    };

    for (const malformed of [
      { id: "missing", from: "dataset", fromPort: "out", to: "ghost", toPort: "in", kind: "pred" as const },
      { id: "port", from: "dataset", fromPort: "out", to: "count", toPort: "not-an-input", kind: "pred" as const },
      { id: "kind", from: "dataset", fromPort: "out", to: "count", toPort: "in", kind: "sel" as const },
    ]) {
      state.edges = { [malformed.id]: malformed };
      const raw = JSON.stringify(toPersistedDoc(state));
      const storage = new MemoryStorage({ active: raw });
      expect(() => loadFromStorage(storage, "active", library)).not.toThrow();
      expect(loadFromStorage(storage, "active", library)).toMatchObject({ kind: "recovery", stage: "topology" });
      expect(storage.bytes.active).toBe(raw);
      expect(storage.writes).toEqual([]);
    }
  });

  test("unresolved-definition incident edges remain inert and byte-preserved", () => {
    const state = emptyState();
    state.nodes.missing = {
      id: "missing",
      definitionRef: exactNodeTypeRef("plugin.example/future", "9.0.0"),
      label: "Future",
    };
    state.edges.future = {
      id: "future",
      from: "missing",
      fromPort: "future-output",
      to: "missing",
      toPort: "future-port",
      kind: "focus",
    };
    const raw = JSON.stringify(toPersistedDoc(state));
    const storage = new MemoryStorage({ active: raw });

    expect(loadFromStorage(storage, "active", library)).toEqual({ kind: "ok", state });
    expect(storage.bytes.active).toBe(raw);
    expect(storage.writes).toEqual([]);
  });

  test("schema-transformed non-JSON config enters config recovery without escaping canonicalization", () => {
    const definitionRef = exactNodeTypeRef("plugin.example/transforming", "1.0.0");
    const schema = z.object({ date: z.boolean() }).transform(({ date }) => (date ? new Date(0) : { date }));
    const spec = {
      definition: {
        ref: definitionRef,
        inputs: [],
        outputs: [{ id: "out", kind: "pred" }],
        config: {
          version: nodeConfigVersion(2),
          defaultValue: { date: false },
          schema,
          migrations: [
            {
              from: nodeConfigVersion(1),
              to: nodeConfigVersion(2),
              migrate: () => ({ date: true }),
            },
          ],
        },
      },
      evaluationRole: "source",
      cook: () => ({ kind: "pred", sql: null }),
    } as unknown as AppNodeSpec;
    const transformingLibrary = {
      ...library,
      getSpecExact(ref: Parameters<AppNodeLibrary["getSpecExact"]>[0]) {
        return ref.nodeTypeId === definitionRef.nodeTypeId && ref.nodeTypeVersion === definitionRef.nodeTypeVersion
          ? spec
          : library.getSpecExact(ref);
      },
    } satisfies AppNodeLibrary;
    const state = emptyState();
    state.nodes.transforming = {
      id: "transforming",
      definitionRef,
      label: "Transforming",
      config: { version: nodeConfigVersion(1), value: { date: false } },
    };
    const raw = JSON.stringify(toPersistedDoc(state));
    const storage = new MemoryStorage({ active: raw });

    expect(() => loadFromStorage(storage, "active", transformingLibrary)).not.toThrow();
    expect(loadFromStorage(storage, "active", transformingLibrary)).toMatchObject({
      kind: "recovery",
      stage: "config",
    });
    expect(storage.bytes.active).toBe(raw);
    expect(storage.writes).toEqual([]);
  });
});
