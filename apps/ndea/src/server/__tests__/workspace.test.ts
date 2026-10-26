import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceChange } from "@ndea/protocol";
import { parseWorkspaceDocument } from "../../frontend/core/workspace/document.ts";
import type { WorkspaceDocument } from "../../frontend/core/workspace/types.ts";
import {
  handleWorkspaceHistory,
  handleWorkspacePatch,
  handleWorkspaceRestore,
  handleWorkspaceRevision,
} from "../routes/workspace.ts";
import { Harness } from "../harness.ts";
import { Workspace, WorkspaceFileError } from "../workspace.ts";

const HIST = { type: "histogram", props: { field: "area" }, children: [] };
const DOCUMENT = {
  data: {},
  layouts: { main: { name: "Main", spec: { root: "hist", elements: { hist: HIST } } } },
  layout: "main",
  state: {},
};
const BINS = "/layouts/main/spec/elements/hist/props/bins";

const addData = (name: string) => ({ op: "add" as const, path: `/data/${name}`, value: { sql: "area > 20" } });
const browser = { kind: "browser" } as const;
const cli = { kind: "cli" } as const;

let dir: string;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const noSeed = () => Promise.reject(new Error("an existing file must not be seeded"));
const validate = async () => [];

async function seed(): Promise<WorkspaceDocument> {
  const parsed = parseWorkspaceDocument(DOCUMENT);
  if (!parsed.ok) throw new Error("fixture document is invalid");
  return parsed.value;
}

/** A missing file is seeded and written as revision 1. */
async function seeded(): Promise<{ workspace: Workspace; path: string }> {
  dir = await mkdtemp(join(tmpdir(), "ndea-workspace-"));
  const path = join(dir, "nested", "workspace.json");
  const workspace = await Workspace.open(path, seed, { validate });
  expect(workspace.get()).toEqual({ revision: 1, document: DOCUMENT, name: "workspace" });
  expect(await Bun.file(path).json()).toMatchObject({ revision: 1, document: DOCUMENT });
  return { workspace, path };
}

describe("Workspace", () => {
  test("persists accepted revisions and history beside the file, and reopens both", async () => {
    const { workspace, path } = await seeded();
    expect(await workspace.patch([addData("large")], { base: 1, actor: cli })).toEqual({
      kind: "accepted",
      revision: 2,
    });
    expect(await Bun.file(path).json()).toMatchObject({ format: "ndea.workspace", version: 3, revision: 2 });
    expect(await Bun.file(join(dir, "nested", "workspace.history.sqlite")).exists()).toBe(true);
    const reopened = await Workspace.open(path, noSeed, { validate });
    expect(reopened.get()).toEqual(workspace.get());
    expect(reopened.history()).toEqual(workspace.history());
    expect(reopened.history().map((r) => r.actor.kind)).toEqual(["cli", "system"]);
  });

  test("rejects a stale base revision with the current snapshot and changes nothing", async () => {
    const { workspace, path } = await seeded();
    const before = await Bun.file(path).text();
    const result = await workspace.patch([addData("large")], { base: 0, actor: browser });
    expect(result).toEqual({ kind: "conflict", snapshot: { revision: 1, document: DOCUMENT, name: "workspace" } });
    expect(await Bun.file(path).text()).toBe(before);
    expect(workspace.history()).toHaveLength(1);
  });

  test("a rejected patch leaves document, revision, file, and history unchanged", async () => {
    const { workspace, path } = await seeded();
    const before = await Bun.file(path).text();
    const history = workspace.history();
    const bad = await workspace.patch([{ op: "add", path: BINS, value: "many" }], {
      base: 1,
      actor: browser,
    });
    expect(bad).toMatchObject({ kind: "invalid", issues: [{ pointer: BINS }] });
    expect(await workspace.patch([{ op: "remove", path: "/data/missing" }], { base: 1, actor: browser })).toMatchObject(
      {
        kind: "invalid",
        issues: [{ pointer: "/data/missing" }],
      },
    );
    expect(workspace.get()).toEqual({ revision: 1, document: DOCUMENT, name: "workspace" });
    expect(workspace.history()).toEqual(history);
    expect(await Bun.file(path).text()).toBe(before);
  });

  test("the accepted document is frozen; mutating a snapshot throws and changes nothing", async () => {
    const { workspace, path } = await seeded();
    const history = workspace.history();
    const document = workspace.get().document as WorkspaceDocument;
    expect(() => {
      document.data.large = { sql: "area > 20" };
    }).toThrow(TypeError);
    expect(() => {
      document.layouts.main.spec.elements.hist.props.field = "perimeter";
    }).toThrow(TypeError);
    expect(workspace.get()).toEqual({ revision: 1, document: DOCUMENT, name: "workspace" });
    expect(workspace.history()).toEqual(history);
    // Patches still apply (to a clone), and the next accepted document is frozen too.
    expect(await workspace.patch([addData("large")], { base: 1, actor: cli })).toEqual({
      kind: "accepted",
      revision: 2,
    });
    expect(Object.isFrozen((workspace.get().document as WorkspaceDocument).data.large)).toBe(true);
    expect(await Bun.file(path).json()).toMatchObject({
      revision: 2,
      document: { data: { large: { sql: "area > 20" } } },
    });
  });

  test("the injected validation rejects like a structural issue", async () => {
    const workspace = Workspace.memory(undefined, {
      validate: async (document) =>
        Object.keys(document.data).includes("nope") ? [{ pointer: "/data/nope", detail: "no" }] : [],
    });
    expect(await workspace.patch([addData("nope")], { base: 0, actor: browser })).toEqual({
      kind: "invalid",
      issues: [{ pointer: "/data/nope", detail: "no" }],
    });
    expect(workspace.get().revision).toBe(0);
    expect(workspace.history()).toEqual([]);
  });

  test("serialized concurrent writers on the same base: one wins, one conflicts", async () => {
    const workspace = Workspace.memory();
    const results = await Promise.all([
      workspace.patch([addData("a")], { base: 0, actor: browser }),
      workspace.patch([addData("b")], { base: 0, actor: cli }),
    ]);
    expect(results.map((result) => result.kind).toSorted()).toEqual(["accepted", "conflict"]);
    expect(workspace.get().revision).toBe(1);
    expect(workspace.history()).toHaveLength(1);
  });

  test("history records actor, ops, and time newest first, and pages with before/limit", async () => {
    const workspace = Workspace.memory();
    const omp = { kind: "mcp", agent: "omp" } as const;
    await workspace.patch([addData("a")], { base: 0, actor: browser });
    await workspace.patch([addData("b")], { base: 1, actor: cli });
    await workspace.patch([addData("c")], { base: 2, actor: omp });
    const all = workspace.history();
    expect(all.map((r) => [r.revision, r.baseRevision, r.actor])).toEqual([
      [3, 2, omp],
      [2, 1, cli],
      [1, 0, browser],
    ]);
    expect(all[0].ops).toEqual([addData("c")]);
    expect(Number.isNaN(Date.parse(all[0].committedAt))).toBe(false);
    expect(workspace.history({ limit: 1 }).map((r) => r.revision)).toEqual([3]);
    expect(workspace.history({ before: 3, limit: 1 }).map((r) => r.revision)).toEqual([2]);
    expect(workspace.history({ before: 2 }).map((r) => r.revision)).toEqual([1]);
  });

  test("restore N commits a new revision equal to snapshot N, with restoredFrom", async () => {
    const workspace = Workspace.memory();
    await workspace.patch([addData("a")], { base: 0, actor: browser });
    await workspace.patch([addData("b")], { base: 1, actor: browser });
    await workspace.patch([{ op: "remove", path: "/data/a" }], { base: 2, actor: browser });
    expect(await workspace.restore(1, { base: 2, actor: cli })).toMatchObject({ kind: "conflict" });
    expect(await workspace.restore(9, { base: 3, actor: cli })).toEqual({ kind: "not-found" });
    expect(await workspace.restore(1, { base: 3, actor: cli })).toEqual({ kind: "accepted", revision: 4 });
    expect(workspace.get().document).toEqual(workspace.at(1)!.document);
    expect(workspace.at(4)).toEqual(workspace.get());
    expect(workspace.history({ limit: 1 })[0]).toMatchObject({
      revision: 4,
      baseRevision: 3,
      actor: cli,
      restoredFrom: 1,
    });
  });

  test("watchers receive the committed record with the writer's client id, only after commit", async () => {
    const workspace = Workspace.memory();
    const changes: WorkspaceChange[] = [];
    const stop = workspace.watch((change) => {
      expect(workspace.history({ limit: 1 })[0]?.revision).toBe(change.revision);
      changes.push(change);
    });
    await workspace.patch([addData("a")], { base: 0, actor: browser, clientId: "client-a" });
    await workspace.patch([addData("b"), { op: "remove", path: "/nope" }], { base: 1, actor: browser });
    stop();
    expect(changes).toEqual([
      {
        revision: 1,
        baseRevision: 0,
        actor: browser,
        ops: [addData("a")],
        committedAt: changes[0].committedAt,
        clientId: "client-a",
      },
    ]);
  });

  test("a failed file write rolls back the history row and changes nothing", async () => {
    const { workspace, path } = await seeded();
    // The atomic write goes through `<path>.<pid>.tmp`; a directory there makes it throw.
    await mkdir(`${path}.${process.pid}.tmp`);
    const history = workspace.history();
    await expect(workspace.patch([addData("a")], { base: 1, actor: browser })).rejects.toThrow();
    await rm(`${path}.${process.pid}.tmp`, { recursive: true });
    expect(workspace.get()).toEqual({ revision: 1, document: DOCUMENT, name: "workspace" });
    expect(workspace.history()).toEqual(history);
    expect(workspace.at(2)).toBeUndefined();
    // The queue survives the failure.
    expect(await workspace.patch([addData("a")], { base: 1, actor: browser })).toEqual({
      kind: "accepted",
      revision: 2,
    });
  });

  test("opening a workspace without history inserts a system baseline for its revision", async () => {
    const { workspace, path } = await seeded();
    await workspace.patch([addData("a")], { base: 1, actor: browser });
    await rm(join(dir, "nested", "workspace.history.sqlite"));
    const reopened = await Workspace.open(path, noSeed, { validate });
    expect(reopened.history()).toEqual([
      { revision: 2, baseRevision: 1, actor: { kind: "system" }, ops: [], committedAt: expect.any(String) },
    ]);
    expect(reopened.at(2)).toEqual(reopened.get());
  });

  test("a history ahead of the file is trimmed to the file's revision", async () => {
    const { workspace, path } = await seeded();
    const stale = await Bun.file(path).text();
    await workspace.patch([addData("a")], { base: 1, actor: browser });
    await Bun.write(path, stale);
    const reopened = await Workspace.open(path, noSeed, { validate });
    expect(reopened.get().revision).toBe(1);
    expect(reopened.history().map((r) => r.revision)).toEqual([1]);
    expect(
      new Database(join(dir, "nested", "workspace.history.sqlite")).query("SELECT count(*) AS n FROM revisions").get(),
    ).toEqual({ n: 1 });
  });

  test("refuses a file of another format version (a v2 file) and says to delete it", async () => {
    const { path } = await seeded();
    const file = await Bun.file(path).json();
    await Bun.write(path, JSON.stringify({ ...file, version: 2 }));
    const opened = Workspace.open(path, noSeed, { validate });
    await expect(opened).rejects.toBeInstanceOf(WorkspaceFileError);
    await expect(opened).rejects.toThrow(`/version: format version 2 is not supported`);
    await expect(opened).rejects.toThrow(`delete ${path} to reseed it from the preset`);
  });
});

describe("workspace REST", () => {
  const send = (method: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://x${path}`, { method, headers, body: JSON.stringify(body) });

  test("stamps browser by default and cli with X-Ndea-Client: cli; history, revisions, restore", async () => {
    const workspace = Workspace.memory();
    // Harness edits default to propose: the person's own writes never wait for review.
    const state = { workspace, harness: new Harness(workspace) };
    const ok = await handleWorkspacePatch(
      send("PATCH", "/api/workspace", { baseRevision: 0, ops: [addData("a")] }),
      state,
    );
    expect(await ok.json()).toEqual({ revision: 1 });
    // The actor comes from the transport, never the body.
    const viaCli = send(
      "PATCH",
      "/api/workspace",
      { baseRevision: 1, ops: [addData("b")], actor: { kind: "mcp" } },
      {
        "x-ndea-client": "cli",
      },
    );
    expect((await handleWorkspacePatch(viaCli, state)).status).toBe(200);

    const history = await handleWorkspaceHistory(new Request("http://x/api/workspace/history?limit=5"), state);
    expect((await history.json()).revisions.map((r: { actor: unknown }) => r.actor)).toEqual([cli, browser]);
    const paged = await handleWorkspaceHistory(new Request("http://x/api/workspace/history?before=2"), state);
    expect((await paged.json()).revisions).toHaveLength(1);
    expect((await handleWorkspaceHistory(new Request("http://x/api/workspace/history?limit=0"), state)).status).toBe(
      400,
    );

    expect((await handleWorkspaceRevision("7", state)).status).toBe(404);
    const first = await (await handleWorkspaceRevision("1", state)).json();
    const restore = (body: unknown) =>
      handleWorkspaceRestore(send("POST", "/api/workspace/restore", body, { "x-ndea-client": "cli" }), state);
    expect((await restore({ revision: 1, baseRevision: 1 })).status).toBe(409);
    expect((await restore({ revision: 9, baseRevision: 2 })).status).toBe(404);
    expect((await restore({ revision: 0, baseRevision: 2 })).status).toBe(400);
    expect(await (await restore({ revision: 1, baseRevision: 2 })).json()).toEqual({ revision: 3 });
    expect(state.workspace.get().document).toEqual(first.document);
    expect(state.workspace.history({ limit: 1 })[0]).toMatchObject({ actor: cli, restoredFrom: 1 });
  });
});
