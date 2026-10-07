import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObservationSetSchema, WorkspaceProblemSchema } from "@ndea/protocol";
import { ObservationSets } from "../observation-sets.ts";
import { handleSetsPost } from "../routes/sets.ts";
import { handleFilter } from "../routes/filter.ts";
import { handleWorkspacePatch } from "../routes/workspace.ts";
import { DatasetQuerySession } from "../store.ts";
import { WorkspaceDocumentStore } from "../workspace.ts";

let dir: string;
const stores: DatasetQuerySession[] = [];
afterEach(async () => {
  for (const store of stores) store.close();
  stores.length = 0;
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function session(multi = true, reversed = false) {
  const store = await DatasetQuerySession.fromInit(async (conn) => {
    await conn.run(`CREATE TABLE obs_base AS SELECT * FROM (VALUES
      (0, '${reversed ? "c" : "a"}'${multi ? ", 'first'" : ""}),
      (1, 'b'${multi ? ", 'first'" : ""}),
      (2, '${reversed ? "a" : "c"}'${multi ? ", 'second'" : ""})
    ) AS t(__row_index__, obs_name${multi ? ", _dataset" : ""})`);
  });
  stores.push(store);
  return {
    store,
    observationSets: new ObservationSets(store, join(dir, "sets")),
    datasets: new Map([
      ["first", { path: "/first.zarr" }],
      ["second", { path: "/second.zarr" }],
    ]),
    workspace: WorkspaceDocumentStore.empty(join(dir, "workspace.json")),
  };
}

function request(body: unknown) {
  return new Request("http://x/api/sets", { method: "POST", body: JSON.stringify(body) });
}

test("sets have stable ids, deduplicate rows, and compile to the exact inSet population", async () => {
  dir = await mkdtemp(join(tmpdir(), "ndea-sets-"));
  const state = await session();
  const response = await handleSetsPost(request({ rowIndices: [0, 2, 0] }), state);
  expect(response.status).toBe(200);
  const created = ObservationSetSchema.parse(await response.json());
  expect(created.count).toBe(2);
  expect(created.set).toMatch(/^[0-9a-f]{16}$/);
  expect(await state.observationSets.create([2, 0])).toEqual(created);
  const filtered = await handleFilter(request({ where: { op: "inSet", set: created.set } }), state);
  const filteredBody = await filtered.json();
  expect({ status: filtered.status, body: filteredBody }).toMatchObject({
    status: 200,
    body: { count: 2, rows: [{ rowIndex: 0 }, { rowIndex: 2 }] },
  });
  expect((await handleSetsPost(request({ rowIndices: [0, 99] }), state)).status).toBe(400);
  expect((await handleSetsPost(request({ rowIndices: [-1] }), state)).status).toBe(400);
  const restored = await session();
  expect(await restored.observationSets.ensure([created.set])).toEqual([]);
  expect(
    await (await handleFilter(request({ where: { op: "inSet", set: created.set } }), restored)).json(),
  ).toMatchObject({ count: 2 });
});

test("single-dataset sets restore identities after row handles change", async () => {
  dir = await mkdtemp(join(tmpdir(), "ndea-sets-"));
  const original = await session(false);
  const created = await original.observationSets.create([0]);
  const restored = await session(false, true);
  expect(await restored.observationSets.ensure([created.set])).toEqual([]);
  expect(await restored.observationSets.create([2])).toEqual(created);
  expect(
    await (await handleFilter(request({ where: { op: "inSet", set: created.set } }), restored)).json(),
  ).toMatchObject({ count: 1, rows: [{ rowIndex: 2, obsName: "a" }] });
});

test("PATCH rejects unknown nested set references with a clause pointer and preserves revision", async () => {
  dir = await mkdtemp(join(tmpdir(), "ndea-sets-"));
  const state = await session();
  const document = {
    nodeAssets: [],
    nodes: {},
    edges: {},
    positions: {},
    sizeOverrides: {},
    formOverride: {},
    formLocked: {},
    explicit: {},
    stageTree: null,
    stripH: 280,
    flags: {},
    state: {},
    bindings: {},
  };
  expect(await state.workspace.apply(0, [{ op: "add", path: "", value: document }])).toEqual({
    kind: "accepted",
    revision: 1,
  });
  const snapshot = state.workspace.snapshot();
  const response = await handleWorkspacePatch(
    request({
      baseRevision: 1,
      ops: [
        {
          op: "add",
          path: "/state/filter",
          value: {
            A: {
              agent: {
                "facet/~": {
                  op: "or",
                  clauses: [{ op: "and", clauses: [{ op: "not", clause: { op: "inSet", set: "0000000000000000" } }] }],
                },
              },
            },
          },
        },
      ],
    }),
    state,
  );
  expect(response.status).toBe(400);
  expect(response.headers.get("content-type")).toBe("application/problem+json");
  expect(WorkspaceProblemSchema.parse(await response.json()).errors).toEqual([
    {
      pointer: "/state/filter/A/agent/facet~1~0/clauses/0/clauses/0/clause",
      detail: 'unknown observation set "0000000000000000"',
    },
  ]);
  expect(state.workspace.snapshot()).toEqual(snapshot);
  const created = await state.observationSets.create([0]);
  expect(
    (
      await handleWorkspacePatch(
        request({
          baseRevision: 1,
          ops: [
            {
              op: "add",
              path: "/state/filter",
              value: { A: { agent: { selection: { op: "inSet", set: created.set } } } },
            },
          ],
        }),
        state,
      )
    ).status,
  ).toBe(200);
});
