import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceChange } from "@ndea/protocol";
import { WorkspaceDocumentStore, WorkspaceFileError } from "../workspace.ts";

const DOCUMENT = {
  nodeAssets: [],
  nodes: { a: { id: "a", definitionRef: { nodeTypeId: "obs", nodeTypeVersion: "1.0.0" }, label: "obs" } },
  edges: {},
  positions: { a: { x: 0, y: 0 } },
  sizeOverrides: {},
  formOverride: {},
  formLocked: {},
  explicit: {},
  stageTree: null,
  stripH: 280,
  flags: {},
  coordinationScopes: {},
  coordinationSpace: {},
};

let dir: string;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function seeded(): Promise<{ store: WorkspaceDocumentStore; path: string }> {
  dir = await mkdtemp(join(tmpdir(), "ndea-workspace-"));
  const path = join(dir, "nested", "workspace.json");
  const store = await WorkspaceDocumentStore.open(path);
  expect(await store.apply(0, [{ op: "add", path: "", value: DOCUMENT }])).toEqual({ kind: "accepted", revision: 1 });
  return { store, path };
}

describe("WorkspaceDocumentStore", () => {
  test("persists accepted revisions and reopens the same snapshot", async () => {
    const { store, path } = await seeded();
    expect(await store.apply(1, [{ op: "replace", path: "/stripH", value: 320 }])).toEqual({
      kind: "accepted",
      revision: 2,
    });
    const file = await Bun.file(path).json();
    expect(file).toMatchObject({ format: "ndea.workspace", version: 1, revision: 2 });
    expect((await WorkspaceDocumentStore.open(path)).snapshot()).toEqual(store.snapshot());
  });

  test("rejects a stale base revision with the current snapshot and changes nothing", async () => {
    const { store, path } = await seeded();
    const before = await Bun.file(path).text();
    const result = await store.apply(0, [{ op: "replace", path: "/stripH", value: 1 }]);
    expect(result).toEqual({ kind: "conflict", snapshot: { revision: 1, document: DOCUMENT } });
    expect(await Bun.file(path).text()).toBe(before);
  });

  test("an invalid result reports JSON Pointers and leaves revision and file unchanged", async () => {
    const { store, path } = await seeded();
    const before = await Bun.file(path).text();
    const edge = { id: "e1", from: "a", fromPort: "out", to: "ghost", toPort: "in", kind: "pred" };
    const result = await store.apply(1, [{ op: "add", path: "/edges/e1", value: edge }]);
    expect(result).toEqual({ kind: "invalid", issues: [{ pointer: "/edges/e1/to", detail: 'unknown node "ghost"' }] });
    expect((await store.apply(1, [{ op: "remove", path: "/nodes/missing" }])).kind).toBe("invalid");
    expect(store.snapshot().revision).toBe(1);
    expect(await Bun.file(path).text()).toBe(before);
  });

  test("concurrent writers on the same base revision cannot both win", async () => {
    const { store } = await seeded();
    const results = await Promise.all([
      store.apply(1, [{ op: "replace", path: "/stripH", value: 100 }]),
      store.apply(1, [{ op: "replace", path: "/stripH", value: 200 }]),
    ]);
    expect(results.map((result) => result.kind).toSorted()).toEqual(["accepted", "conflict"]);
    expect(store.snapshot().revision).toBe(2);
  });

  test("watchers receive accepted ops with the writer's client id", async () => {
    const { store } = await seeded();
    const changes: WorkspaceChange[] = [];
    const stop = store.watch((change) => changes.push(change));
    await store.apply(1, [{ op: "replace", path: "/stripH", value: 300 }], "client-a");
    await store.apply(2, [
      { op: "replace", path: "/stripH", value: 1 },
      { op: "remove", path: "/nope" },
    ]);
    stop();
    expect(changes).toEqual([
      { revision: 2, ops: [{ op: "replace", path: "/stripH", value: 300 }], clientId: "client-a" },
    ]);
  });

  test("refuses to open a file with the wrong format version", async () => {
    const { path } = await seeded();
    const file = await Bun.file(path).json();
    await Bun.write(path, JSON.stringify({ ...file, version: 2 }));
    const opened = WorkspaceDocumentStore.open(path);
    await expect(opened).rejects.toBeInstanceOf(WorkspaceFileError);
    await expect(opened).rejects.toThrow("/version");
  });
});
