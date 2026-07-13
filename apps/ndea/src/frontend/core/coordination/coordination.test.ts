/**
 * Coordination backbone (U1 spike) — store-shape + resolve/notify unit tests.
 *
 * The backbone is the symmetric cross-view plane: N nodes referencing the same
 * (type, scope) share one latest-wins cell. These exercise it directly over a
 * bare `Store<WorkspaceDocumentState>` (no Workspace) — the body-dock seam is covered by the
 * host-routing conformance + manual verification.
 */

import { Store } from "@tanstack/store";
import { describe, expect, test } from "bun:test";

import { Coordination, scopeColor } from "./coordination";
import type { WorkspaceDocumentState } from "@/core/workspace/types";

function fresh(): { co: Coordination; store: Store<WorkspaceDocumentState> } {
  const store = new Store<WorkspaceDocumentState>({
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
  });
  return { co: new Coordination(store), store };
}

describe("Coordination — assignment + shared reads", () => {
  test("two nodes on focus.A share one cell; a write through one is read by both", () => {
    const { co } = fresh();
    co.assignScope("n1", "focus", "A");
    co.assignScope("n2", "focus", "A");

    co.setCoordinationValue("focus", "A", "obs_8");
    // both resolve the same cell
    expect(co.readCoordination("focus", co.scopeOf("n1", "focus")!)).toBe("obs_8");
    expect(co.readCoordination("focus", co.scopeOf("n2", "focus")!)).toBe("obs_8");
  });

  test("nodesInScope is the reverse index for fan-out", () => {
    const { co } = fresh();
    co.assignScope("n1", "focus", "A");
    co.assignScope("n2", "focus", "A");
    co.assignScope("n3", "focus", "B");
    expect(co.nodesInScope("focus", "A").toSorted()).toEqual(["n1", "n2"]);
    expect(co.nodesInScope("focus", "B")).toEqual(["n3"]);
  });

  test("focus.B is independent of focus.A", () => {
    const { co } = fresh();
    co.assignScope("n1", "focus", "A");
    co.assignScope("n2", "focus", "B");
    co.setCoordinationValue("focus", "A", "obs_1");
    expect(co.readCoordination("focus", "B")).toBeUndefined();
    co.setCoordinationValue("focus", "B", "obs_2");
    expect(co.readCoordination("focus", "A")).toBe("obs_1"); // unchanged
  });

  test("latest-wins: the most recent set is the value read", () => {
    const { co } = fresh();
    co.assignScope("n1", "focus", "A");
    co.setCoordinationValue("focus", "A", "obs_1");
    co.setCoordinationValue("focus", "A", "obs_2");
    expect(co.readCoordination("focus", "A")).toBe("obs_2");
  });

  test("clearScope removes the node's type entry (and prunes the empty record)", () => {
    const { co, store } = fresh();
    co.assignScope("n1", "focus", "A");
    co.clearScope("n1", "focus");
    expect(co.scopeOf("n1", "focus")).toBeUndefined();
    expect(store.state.coordinationScopes.n1).toBeUndefined();
  });

  test("an unassigned node resolves no scope (the unscoped fallback path)", () => {
    const { co } = fresh();
    expect(co.scopeOf("nope", "focus")).toBeUndefined();
  });

  test("mintScope returns a fresh, unused scope name", () => {
    const { co } = fresh();
    co.assignScope("n1", "focus", "A");
    expect(co.mintScope("focus")).toBe("B"); // A is taken
  });

  test("existingScopes lists every referenced scope (picker source, KD9)", () => {
    const { co } = fresh();
    co.assignScope("n1", "focus", "A");
    co.assignScope("n2", "focus", "C");
    co.assignScope("n3", "viewSync", "lock1");
    expect(co.existingScopes("focus")).toEqual(["A", "C"]); // sorted, deduped, focus only
    expect(co.existingScopes("viewSync")).toEqual(["lock1"]);
    expect(co.existingScopes("ordering")).toEqual([]);
  });
});

describe("Coordination — selector-scoped subscribe (KD5)", () => {
  test("fires on the resolved cell changing", () => {
    const { co } = fresh();
    co.assignScope("n1", "focus", "A");
    const seen: (string | null | undefined)[] = [];
    const off = co.subscribe("n1", "focus", (v) => seen.push(v as string | null));
    co.setCoordinationValue("focus", "A", "obs_1");
    co.setCoordinationValue("focus", "A", "obs_2");
    off();
    expect(seen).toEqual(["obs_1", "obs_2"]);
  });

  test("fires when the node's scope membership flips", () => {
    const { co } = fresh();
    co.setCoordinationValue("focus", "A", "obs_1");
    const seen: (string | null | undefined)[] = [];
    const off = co.subscribe("n1", "focus", (v) => seen.push(v as string | null));
    co.assignScope("n1", "focus", "A"); // undefined → "obs_1"
    co.clearScope("n1", "focus"); // "obs_1" → undefined
    off();
    expect(seen).toEqual(["obs_1", undefined]);
  });

  test("does NOT fire for a write to an unrelated scope (no render storm)", () => {
    const { co } = fresh();
    co.assignScope("n1", "focus", "A");
    let fires = 0;
    const off = co.subscribe("n1", "focus", () => fires++);
    co.setCoordinationValue("focus", "B", "obs_x"); // different scope
    co.assignScope("n2", "focus", "B"); // different node
    off();
    expect(fires).toBe(0);
  });
});

describe("Coordination — object cells (viewSync) + type isolation", () => {
  test("an object cell (pan/zoom) is shared across nodes on the scope", () => {
    const { co } = fresh();
    co.assignScope("a", "viewSync", "lock1");
    co.assignScope("b", "viewSync", "lock1");
    co.setCoordinationValue("viewSync", "lock1", { panX: 1, panY: 2, zoom: 3, src: "a" });
    expect(co.readCoordination("viewSync", "lock1")).toEqual({ panX: 1, panY: 2, zoom: 3, src: "a" });
    expect(co.nodesInScope("viewSync", "lock1").toSorted()).toEqual(["a", "b"]);
  });

  test("focus and viewSync scopes are independent types on the same node", () => {
    const { co } = fresh();
    co.assignScope("a", "focus", "A");
    co.assignScope("a", "viewSync", "lock1");
    expect(co.scopeOf("a", "focus")).toBe("A");
    expect(co.scopeOf("a", "viewSync")).toBe("lock1");
    co.clearScope("a", "viewSync");
    expect(co.scopeOf("a", "focus")).toBe("A"); // focus untouched
    expect(co.scopeOf("a", "viewSync")).toBeUndefined();
  });

  test("a fresh object value fires subscribe (reference changes each set)", () => {
    const { co } = fresh();
    co.assignScope("a", "viewSync", "lock1");
    let fires = 0;
    const off = co.subscribe("a", "viewSync", () => fires++);
    co.setCoordinationValue("viewSync", "lock1", { panX: 1, panY: 0, zoom: 1, src: "b" });
    co.setCoordinationValue("viewSync", "lock1", { panX: 1, panY: 0, zoom: 1, src: "b" }); // value-equal, new ref
    off();
    expect(fires).toBe(2);
  });
});

describe("scopeColor", () => {
  test("is stable per scope name (badge color preservation across migration)", () => {
    expect(scopeColor("A")).toBe(scopeColor("A"));
  });
});
