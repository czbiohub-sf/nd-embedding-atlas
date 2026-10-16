import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceChange } from "@ndea/protocol";
import { parseWorkspaceDocument } from "../../frontend/core/workspace/document.ts";
import { WorkspaceDocumentStore, WorkspaceFileError } from "../workspace.ts";

const DOCUMENT = {
  data: {},
  spec: { root: "hist", elements: { hist: { type: "histogram", props: { field: "area" }, children: [] } } },
  state: {},
};

const addData = (name: string) => ({ op: "add" as const, path: `/data/${name}`, value: { sql: "area > 20" } });

let dir: string;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const noSeed = () => Promise.reject(new Error("an existing file must not be seeded"));

/** A missing file is seeded and written as revision 1. */
async function seeded(): Promise<{ store: WorkspaceDocumentStore; path: string }> {
  dir = await mkdtemp(join(tmpdir(), "ndea-workspace-"));
  const path = join(dir, "nested", "workspace.json");
  const store = await WorkspaceDocumentStore.open(path, async () => {
    const parsed = parseWorkspaceDocument(DOCUMENT);
    if (!parsed.ok) throw new Error("fixture document is invalid");
    return parsed.value;
  });
  expect(store.snapshot()).toEqual({ revision: 1, document: DOCUMENT });
  expect(await Bun.file(path).json()).toMatchObject({ revision: 1, document: DOCUMENT });
  return { store, path };
}

describe("WorkspaceDocumentStore", () => {
  test("persists accepted revisions and reopens the same snapshot", async () => {
    const { store, path } = await seeded();
    expect(await store.apply(1, [addData("large")])).toEqual({ kind: "accepted", revision: 2 });
    const file = await Bun.file(path).json();
    expect(file).toMatchObject({ format: "ndea.workspace", version: 2, revision: 2 });
    expect((await WorkspaceDocumentStore.open(path, noSeed)).snapshot()).toEqual(store.snapshot());
  });

  test("rejects a stale base revision with the current snapshot and changes nothing", async () => {
    const { store, path } = await seeded();
    const before = await Bun.file(path).text();
    const result = await store.apply(0, [addData("large")]);
    expect(result).toEqual({ kind: "conflict", snapshot: { revision: 1, document: DOCUMENT } });
    expect(await Bun.file(path).text()).toBe(before);
  });

  test("a bad component prop is refused with its element pointer; revision and file unchanged", async () => {
    const { store, path } = await seeded();
    const before = await Bun.file(path).text();
    const result = await store.apply(1, [{ op: "add", path: "/spec/elements/hist/props/bins", value: "many" }]);
    expect(result).toMatchObject({ kind: "invalid", issues: [{ pointer: "/spec/elements/hist/props/bins" }] });
    expect(await store.apply(1, [{ op: "remove", path: "/data/missing" }])).toMatchObject({
      kind: "invalid",
      issues: [{ pointer: "/data/missing" }],
    });
    expect(store.snapshot().revision).toBe(1);
    expect(await Bun.file(path).text()).toBe(before);
  });

  test("concurrent writers on the same base revision cannot both win", async () => {
    const { store } = await seeded();
    const results = await Promise.all([store.apply(1, [addData("a")]), store.apply(1, [addData("b")])]);
    expect(results.map((result) => result.kind).toSorted()).toEqual(["accepted", "conflict"]);
    expect(store.snapshot().revision).toBe(2);
  });

  test("watchers receive accepted ops with the writer's client id", async () => {
    const { store } = await seeded();
    const changes: WorkspaceChange[] = [];
    const stop = store.watch((change) => changes.push(change));
    await store.apply(1, [addData("a")], "client-a");
    await store.apply(2, [addData("b"), { op: "remove", path: "/nope" }]);
    stop();
    expect(changes).toEqual([{ revision: 2, ops: [addData("a")], clientId: "client-a" }]);
  });

  test("refuses to open a file with the wrong format version", async () => {
    const { path } = await seeded();
    const file = await Bun.file(path).json();
    await Bun.write(path, JSON.stringify({ ...file, version: 1 }));
    const opened = WorkspaceDocumentStore.open(path, noSeed);
    await expect(opened).rejects.toBeInstanceOf(WorkspaceFileError);
    await expect(opened).rejects.toThrow("/version");
  });
});
