/**
 * Persistence round-trip (Track B) — the save → validate → load path, end to end.
 *
 * The foundation (`persist.test.ts`) asserts the versioned-doc + parse-on-load
 * hook in isolation. These exercise the actual plumbing:
 *   - a graph saved to storage reloads into a FRESH Workspace and reproduces the
 *     topology AND genuinely cooks (engine registration + edges rehydrated, not
 *     just `store.setState`) — the load-bearing requirement.
 *   - an invalid stored doc is rejected so the seam can fall back to seed.
 *
 * Reads are synchronous via engine.pull — no flush/rAF needed beyond the ctor stub.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { registerBuiltinNodes } from "./nodes";
import { loadFromStorage, saveToStorage, storageKey, toPersistedDoc, validateDoc } from "./persist";
import { seedWorkspace, sqlOf, Workspace } from "./workspace-store";
import type { Metadata } from "@ndea/protocol";

// rAF doesn't exist under bun:test — the Workspace ctor references it for the
// flush scheduler. We pull synchronously, so a no-op stub is enough.
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= (() => 0) as unknown;

registerBuiltinNodes();

function makeWs() {
  return new Workspace({
    coordinator: { query: () => Promise.resolve([]) } as never,
    table: "atlas",
    metadata: { dataset_keys: [] } as unknown as Metadata,
  });
}

const cookSql = (ws: Workspace, id: string) => sqlOf(ws.engine.pull(id));

// In-memory localStorage shim for the storage-key path (bun:test has none).
function installStorageShim() {
  const map = new Map<string, string>();
  const shim = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  (globalThis as { localStorage?: unknown }).localStorage = shim as unknown;
  return map;
}

describe("persistence round-trip (Track B)", () => {
  test("a saved graph reloads into a fresh Workspace, reproduces topology, and cooks", () => {
    // ── author a graph: obs → wrangle(pred) → cache, plus a count sink ──
    const src = makeWs();
    const obs = src.addNode("obs", { x: 0, y: 0 }, "obs");
    const wr = src.addNode("wrangle", { x: 100, y: 0 });
    const cache = src.addNode("cache", { x: 200, y: 0 });
    const count = src.addNode("count", { x: 300, y: 0 });
    src.connect(obs, wr);
    src.connect(wr, cache);
    src.connect(cache, count);
    // wrangle's compiled predicate lives in the body's runtime map, NOT the
    // document — persist its source-of-truth (`prql` config) so the loaded body
    // recompiles. For this test we assert topology+cook; seed a doc-level pred via
    // a fresh wrangle compile after load (below) to prove the wire carries it.
    src.setWranglePred(wr, "x > 1");
    expect(cookSql(src, cache)).toBe("x > 1");
    expect(cookSql(src, count)).toBe("x > 1");

    // ── save → validate → load into a brand-new Workspace ──
    const doc = toPersistedDoc(src.store.state);
    expect(validateDoc(doc).ok).toBe(true);

    const dst = makeWs();
    dst.loadDocument(doc.state);

    // topology reproduced
    expect(Object.keys(dst.store.state.nodes).toSorted()).toEqual([cache, count, obs, wr].toSorted());
    expect(Object.keys(dst.store.state.edges).length).toBe(3);

    // it genuinely COOKS: a freshly-compiled wrangle predicate flows obs → wrangle
    // → cache → count through the rehydrated engine edges (proves engine
    // registration + reconnection, not an inert store-only restore).
    dst.setWranglePred(wr, "y < 5");
    expect(cookSql(dst, cache)).toBe("y < 5");
    expect(cookSql(dst, count)).toBe("y < 5");
  });

  test("the realistic seed document round-trips and cooks", () => {
    const src = makeWs();
    seedWorkspace(src);
    const doc = toPersistedDoc(src.store.state);
    expect(validateDoc(doc).ok).toBe(true);

    const dst = makeWs();
    dst.loadDocument(doc.state);

    // same node + edge counts as the seed
    expect(Object.keys(dst.store.state.nodes).length).toBe(Object.keys(src.store.state.nodes).length);
    expect(Object.keys(dst.store.state.edges).length).toBe(Object.keys(src.store.state.edges).length);

    // every node pulls a value (registered + cooks); count sink follows the wrangle
    const wrId = Object.values(dst.store.state.nodes).find((n) => n.type === "wrangle")!.id;
    const countId = Object.values(dst.store.state.nodes).find((n) => n.type === "count")!.id;
    dst.setWranglePred(wrId, "z = 3");
    expect(cookSql(dst, countId)).toBe("z = 3");
  });

  test("a sel (lasso) edge rehydrates on its push port — re-emit flows downstream", () => {
    const src = makeWs();
    const obs = src.addNode("obs", { x: 0, y: 0 }, "obs");
    const sc = src.addNode("scatter", { x: 100, y: 0 });
    const cache = src.addNode("cache", { x: 200, y: 0 });
    src.connect(obs, sc);
    src.connect(sc, cache); // sel push wire

    const dst = makeWs();
    dst.loadDocument(toPersistedDoc(src.store.state).state);

    // emissions are runtime (not persisted) — but the push wire is rehydrated, so a
    // fresh lasso emission delivers downstream through it.
    dst.emitLasso(sc, "__row_index__ IN (1, 2)", [1, 2]);
    expect(cookSql(dst, cache)).toBe("__row_index__ IN (1, 2)");
  });

  test("coordination scopes + cells survive a full Workspace save → load", () => {
    const src = makeWs();
    const obs = src.addNode("obs", { x: 0, y: 0 }, "obs");
    const sc = src.addNode("scatter", { x: 100, y: 0 });
    src.connect(obs, sc);
    // link the scatter onto a focus scope + set the shared cell
    src.coordination.assignScope(sc, "focus", "A");
    src.coordination.setCoordinationValue("focus", "A", "obs_8");
    src.coordination.assignScope(sc, "viewSync", "lock1");

    const doc = toPersistedDoc(src.store.state);
    expect(validateDoc(doc).ok).toBe(true);

    const dst = makeWs();
    dst.loadDocument(doc.state);

    expect(dst.coordination.scopeOf(sc, "focus")).toBe("A");
    expect(dst.coordination.scopeOf(sc, "viewSync")).toBe("lock1");
    expect(dst.coordination.readCoordination("focus", "A")).toBe("obs_8");
  });

  test("id sequences advance past restored ids — a subsequent addNode can't collide", () => {
    const src = makeWs();
    src.addNode("obs", { x: 0, y: 0 }, "obs");
    const wr = src.addNode("wrangle", { x: 100, y: 0 }); // wrangle-1
    src.connect("obs", wr); // e1

    const dst = makeWs();
    dst.loadDocument(toPersistedDoc(src.store.state).state);

    const fresh = dst.addNode("wrangle", { x: 0, y: 0 });
    expect(dst.store.state.nodes[fresh]).toBeDefined();
    expect(fresh).not.toBe(wr); // no id collision with the restored wrangle-1
  });
});

describe("storage backend + invalid-doc fallback", () => {
  let restore: unknown;
  beforeEach(() => {
    restore = (globalThis as { localStorage?: unknown }).localStorage;
    installStorageShim();
  });
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = restore;
  });

  test("save → loadFromStorage returns the validated state", () => {
    const ws = makeWs();
    seedWorkspace(ws);
    const key = storageKey("dsA:atlas");
    saveToStorage(key, ws.store.state);

    const res = loadFromStorage(key);
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") {
      expect(Object.keys(res.state.nodes).length).toBe(Object.keys(ws.store.state.nodes).length);
    }
  });

  test("a missing key is a clean miss (seam seeds, no warning)", () => {
    expect(loadFromStorage(storageKey("nope")).kind).toBe("miss");
  });

  test("a corrupt stored doc is rejected (seam warns + seeds)", () => {
    const key = storageKey("dsB:atlas");
    localStorage.setItem(key, "{ not json");
    expect(loadFromStorage(key).kind).toBe("invalid");
  });

  test("a malformed node config is rejected by parse-on-load", () => {
    const ws = makeWs();
    const ds = ws.addNode("dataset", { x: 0, y: 0 });
    // poke an invalid config straight into the document (datasetKey must be string|null)
    ws.store.setState((s) => ({
      ...s,
      nodes: { ...s.nodes, [ds]: { ...s.nodes[ds], config: { datasetKey: 42 } } },
    }));
    const key = storageKey("dsC:atlas");
    saveToStorage(key, ws.store.state);

    const res = loadFromStorage(key);
    expect(res.kind).toBe("invalid");
    if (res.kind === "invalid") expect(res.errors.join(" ")).toContain(ds);
  });

  test("a future doc version is rejected (migration anchor)", () => {
    const key = storageKey("dsD:atlas");
    localStorage.setItem(key, JSON.stringify({ version: 999, state: { nodes: {}, edges: {} } }));
    const res = loadFromStorage(key);
    expect(res.kind).toBe("invalid");
    if (res.kind === "invalid") expect(res.errors.join(" ")).toContain("migration");
  });

  test("a stored v1 doc migrates to v2 on load — focus.A survives (R6)", () => {
    // a real v1 localStorage doc: a node + the old syncGroups/groupFocus fields.
    const key = storageKey("dsE:atlas");
    const v1 = {
      version: 1,
      state: {
        nodes: { obs: { id: "obs", type: "obs", kind: "source", label: "obs", pluginId: null } },
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
        syncGroups: { obs: "A" },
        groupFocus: { A: "obs_8" },
      },
    };
    localStorage.setItem(key, JSON.stringify(v1));

    const res = loadFromStorage(key);
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") {
      expect(res.state.coordinationScopes).toEqual({ obs: { focus: "A" } });
      expect(res.state.coordinationSpace).toEqual({ focus: { A: "obs_8" } });
      // it hydrates into a fresh Workspace without throwing
      const ws = makeWs();
      ws.loadDocument(res.state);
      expect(ws.coordination.scopeOf("obs", "focus")).toBe("A");
      expect(ws.coordination.readCoordination("focus", "A")).toBe("obs_8");
    }
  });
});
