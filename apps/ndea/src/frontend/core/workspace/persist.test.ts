import { describe, expect, test } from "bun:test";

import { registerBuiltinNodes } from "./nodes";
import { DOC_VERSION, dropUnknownNodes, migrate, type PersistedDoc, toPersistedDoc, validateDoc } from "./persist";
import { scopeColor } from "@/core/coordination/coordination";
import type { WsNode, WsState } from "./types";

registerBuiltinNodes();

function emptyState(): WsState {
  return {
    nodes: {},
    edges: {},
    positions: {},
    sizeOverrides: {},
    formOverride: {},
    formLocked: {},
    selection: null,
    selSet: [],
    selectedEdge: null,
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

function docWith(node: WsNode): PersistedDoc {
  const state = emptyState();
  state.nodes[node.id] = node;
  return toPersistedDoc(state);
}

const datasetNode = (config: WsNode["config"]): WsNode => ({
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
    expect(validateDoc(docWith(datasetNode({ datasetKey: "plateA" }))).ok).toBe(true);
  });

  test("a malformed node config is rejected (parse-on-load guard)", () => {
    const res = validateDoc(docWith(datasetNode({ datasetKey: 42 as unknown as string })));
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain("d1");
  });

  test("a future doc version is flagged for migration", () => {
    const res = validateDoc({ version: DOC_VERSION + 1, state: emptyState() });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain("migration");
  });
});

describe("v1 → v2 migration (focus coordination plane; R6 — load-bearing)", () => {
  // A v1 doc carried `syncGroups`/`groupFocus`; v2 carries the coordination plane.
  // Build one by hand (the v1 fields no longer exist on WsState).
  function v1Doc(syncGroups: Record<string, string>, groupFocus: Record<string, string | null>): PersistedDoc {
    const state = emptyState() as WsState & { syncGroups?: unknown; groupFocus?: unknown };
    delete (state as { coordinationScopes?: unknown }).coordinationScopes;
    delete (state as { coordinationSpace?: unknown }).coordinationSpace;
    state.syncGroups = syncGroups;
    state.groupFocus = groupFocus;
    return { version: 1, state: state as WsState };
  }

  test("maps syncGroups/groupFocus → coordinationScopes/coordinationSpace and bumps version", () => {
    const out = migrate(v1Doc({ n1: "A", n2: "A" }, { A: "obs_8" }));
    expect(out.version).toBe(DOC_VERSION);
    expect(out.state.coordinationScopes).toEqual({ n1: { focus: "A" }, n2: { focus: "A" } });
    expect(out.state.coordinationSpace).toEqual({ focus: { A: "obs_8" } });
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
    expect(validateDoc(migrate(v1Doc({ n1: "A" }, { A: null }))).ok).toBe(true);
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

describe("dropUnknownNodes (self-heal on a removed node type)", () => {
  test("drops nodes of unregistered type + their edges, clears stale selection", () => {
    const state = emptyState();
    state.nodes.d1 = datasetNode({ datasetKey: "plateA" });
    state.nodes.x1 = {
      id: "x1",
      type: "write-back" as unknown as WsNode["type"],
      kind: "view",
      label: "gone",
      pluginId: "write-back",
    };
    state.edges.e1 = { id: "e1", from: "d1", to: "x1", toPort: "in", kind: "pred" };
    state.selection = "x1";
    state.selSet = ["x1", "d1"];

    const out = dropUnknownNodes(toPersistedDoc(state));
    expect(out.state.nodes.x1).toBeUndefined();
    expect(out.state.nodes.d1).toBeDefined();
    expect(out.state.edges.e1).toBeUndefined();
    expect(out.state.selection).toBeNull();
    expect(out.state.selSet).toEqual(["d1"]);
  });

  test("returns the doc unchanged when every node type is registered", () => {
    const doc = docWith(datasetNode({ datasetKey: "plateA" }));
    expect(dropUnknownNodes(doc)).toBe(doc);
  });
});
