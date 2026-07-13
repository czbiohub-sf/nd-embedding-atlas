import { describe, expect, test } from "bun:test";
import { rowIndex } from "@ndea/sdk";

import { DOC_VERSION, fromPersistedDoc, migrate, type PersistedDoc, toPersistedDoc, validateDoc } from "./persist";
import { scopeColor } from "@/core/coordination/coordination";
import { createNativeAppNodeLibrary } from "@/core/node/library";
import type { WorkspaceDocumentState } from "./types";
import type { GraphDocumentNode } from "@/core/graph/records";

const nativeWorkspaceNodeLibrary = createNativeAppNodeLibrary();

function emptyState(): WorkspaceDocumentState {
  return {
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

function docWith(node: GraphDocumentNode): PersistedDoc {
  const state = emptyState();
  state.nodes[node.id] = node;
  return toPersistedDoc(state);
}

const datasetNode = (config: GraphDocumentNode["config"]): GraphDocumentNode => ({
  id: "d1",
  type: "dataset",
  kind: "source",
  label: "Dataset",
  pluginId: null,
  config,
});

describe("persisted doc validation (U7 foundation)", () => {
  test("toPersistedDoc stamps the current version", () => {
    expect(toPersistedDoc(emptyState()).version).toBe(DOC_VERSION);
  });

  test("a valid node config passes", () => {
    expect(validateDoc(docWith(datasetNode({ datasetKey: "plateA" })), nativeWorkspaceNodeLibrary).ok).toBe(true);
  });

  test("a malformed node config is rejected (parse-on-load guard)", () => {
    const res = validateDoc(docWith(datasetNode({ datasetKey: 42 as unknown as string })), nativeWorkspaceNodeLibrary);
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain("d1");
  });

  test("a future doc version is flagged for migration", () => {
    const res = validateDoc({ ...toPersistedDoc(emptyState()), version: DOC_VERSION + 1 }, nativeWorkspaceNodeLibrary);
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain("migration");
  });
});

describe("v1 → v2 migration (focus coordination plane; R6 — load-bearing)", () => {
  // A v1 doc carried `syncGroups`/`groupFocus`; v2 carries the coordination plane.
  // Build one by hand (the v1 fields no longer exist on WorkspaceDocumentState).
  function v1Doc(syncGroups: Record<string, string>, groupFocus: Record<string, string | null>): PersistedDoc {
    const state = toPersistedDoc(emptyState()).state as PersistedDoc["state"] & {
      syncGroups?: unknown;
      groupFocus?: unknown;
    };
    delete (state as { coordinationScopes?: unknown }).coordinationScopes;
    delete (state as { coordinationSpace?: unknown }).coordinationSpace;
    state.syncGroups = syncGroups;
    state.groupFocus = groupFocus;
    return { version: 1, state };
  }

  test("maps syncGroups/groupFocus → coordinationScopes/coordinationSpace and bumps version", () => {
    const out = migrate(v1Doc({ n1: "A", n2: "A" }, { A: "8" }));
    expect(out.version).toBe(DOC_VERSION);
    expect(out.state.coordinationScopes).toEqual({ n1: { focus: "A" }, n2: { focus: "A" } });
    expect(out.state.coordinationSpace).toEqual({ focus: { A: "8" } });
  });

  test("drops the legacy fields and preserves the badge color (same string → same hash)", () => {
    const out = migrate(v1Doc({ n1: "A" }, {}));
    expect((out.state as { syncGroups?: unknown }).syncGroups).toBeUndefined();
    expect((out.state as { groupFocus?: unknown }).groupFocus).toBeUndefined();
    // the scope NAME is the old group id, so the color is byte-for-byte stable
    expect(scopeColor("A")).toBe(scopeColor("A"));
    expect(out.state.coordinationScopes.n1.focus).toBe("A");
  });

  test("a migrated v1 doc passes validation (no version-skew reject — R6)", () => {
    expect(validateDoc(migrate(v1Doc({ n1: "A" }, { A: null })), nativeWorkspaceNodeLibrary).ok).toBe(true);
  });

  test("migrate is a no-op for a current-version doc", () => {
    const doc = toPersistedDoc(emptyState());
    expect(migrate(doc)).toBe(doc);
  });

  test("an empty v1 doc migrates to empty coordination fields", () => {
    const out = migrate(v1Doc({}, {}));
    expect(out.state.coordinationScopes).toEqual({});
    expect(out.state.coordinationSpace).toEqual({});
  });
});

describe("v2 persistence boundary", () => {
  test("writes legacy editor keys and string focus values without leaking runtime keys", () => {
    const state = emptyState();
    state.selectedNodeId = "n1";
    state.selectedNodeIds = ["n1", "n2"];
    state.selectedEdgeId = "e1";
    state.coordinationSpace = {
      focus: { A: rowIndex(8), B: null },
      ordering: { O: { col: "score", dir: "asc" } },
    };

    const serialized = JSON.stringify(toPersistedDoc(state));
    const doc = JSON.parse(serialized) as { state: Record<string, unknown> };
    expect(doc.state.selection).toBe("n1");
    expect(doc.state.selSet).toEqual(["n1", "n2"]);
    expect(doc.state.selectedEdge).toBe("e1");
    expect(doc.state.coordinationSpace).toEqual({
      focus: { A: "8", B: null },
      ordering: { O: { col: "score", dir: "asc" } },
    });
    expect(doc.state.selectedNodeId).toBeUndefined();
    expect(doc.state.selectedNodeIds).toBeUndefined();
    expect(doc.state.selectedEdgeId).toBeUndefined();
  });

  test("reads legacy editor keys and numeric-string focus into canonical runtime state", () => {
    const persisted = toPersistedDoc(emptyState());
    persisted.state.selection = "n1";
    persisted.state.selSet = ["n1", "n2"];
    persisted.state.selectedEdge = "e1";
    persisted.state.coordinationSpace = { focus: { A: "8", B: null } };

    const decoded = fromPersistedDoc(persisted);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.state.selectedNodeId).toBe("n1");
      expect(decoded.state.selectedNodeIds).toEqual(["n1", "n2"]);
      expect(decoded.state.selectedEdgeId).toBe("e1");
      expect(decoded.state.coordinationSpace.focus).toEqual({ A: rowIndex(8), B: null });
      expect("selection" in decoded.state).toBe(false);
      expect("selSet" in decoded.state).toBe(false);
      expect("selectedEdge" in decoded.state).toBe(false);
    }
  });
});

describe("unresolved node persistence", () => {
  test("preserves unknown nodes, incident edges, and editor selection", () => {
    const state = emptyState();
    state.nodes.d1 = datasetNode({ datasetKey: "plateA" });
    state.nodes.x1 = {
      id: "x1",
      type: "write-back" as unknown as GraphDocumentNode["type"],
      kind: "view",
      label: "gone",
      pluginId: "write-back",
    };
    state.edges.e1 = { id: "e1", from: "d1", to: "x1", toPort: "in", kind: "pred" };
    state.selectedNodeId = "x1";
    state.selectedNodeIds = ["x1", "d1"];
    state.selectedEdgeId = "e1";

    const persisted = toPersistedDoc(state);
    expect(validateDoc(persisted, nativeWorkspaceNodeLibrary).ok).toBe(true);
    const decoded = fromPersistedDoc(persisted);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.state.nodes.x1).toEqual(state.nodes.x1);
      expect(decoded.state.nodes.d1).toEqual(state.nodes.d1);
      expect(decoded.state.edges.e1).toEqual(state.edges.e1);
      expect(decoded.state.selectedNodeId).toBe("x1");
      expect(decoded.state.selectedNodeIds).toEqual(["x1", "d1"]);
      expect(decoded.state.selectedEdgeId).toBe("e1");
    }
  });
});
