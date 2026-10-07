import { afterEach, describe, expect, test } from "bun:test";
import type { DuckDBConnection } from "@duckdb/node-api";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceNodeResultSchema } from "@ndea/protocol";
import { handleWorkspaceNode } from "../routes/workspace.ts";
import type { DatasetMountConfig } from "../state.ts";
import { DatasetQuerySession } from "../store.ts";
import { WorkspaceDocumentStore } from "../workspace.ts";

const ref = (nodeTypeId: string) => ({ nodeTypeId, nodeTypeVersion: "1.0.0" });
const edge = (id: string, from: string, to: string) => ({ id, from, fromPort: "out", to, toPort: "in", kind: "pred" });

function document(wranglePredicate: string) {
  return {
    nodeAssets: [],
    nodes: {
      obs: { id: "obs", definitionRef: ref("obs"), label: "obs" },
      filter: {
        id: "filter",
        definitionRef: ref("filter"),
        label: "Infected",
        config: { version: 1, value: { where: { op: "eq", column: "condition", value: "infected" } } },
      },
      count: { id: "count", definitionRef: ref("count"), label: "Count" },
      wrangle: {
        id: "wrangle",
        definitionRef: ref("wrangle"),
        label: "Wrangle",
        config: { version: 1, value: { predicateSql: wranglePredicate } },
      },
      plugin: { id: "plugin", definitionRef: { nodeTypeId: "acme/widget", nodeTypeVersion: "2.0.0" }, label: "?" },
    },
    edges: { e1: edge("e1", "obs", "filter"), e2: edge("e2", "filter", "count"), e3: edge("e3", "obs", "wrangle") },
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
}

let dir: string;
let store: DatasetQuerySession | null = null;
afterEach(async () => {
  store?.close();
  store = null;
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function session(wranglePredicate = "area > 20") {
  dir = await mkdtemp(join(tmpdir(), "ndea-nodes-"));
  store = await DatasetQuerySession.fromInit(async (conn: DuckDBConnection) => {
    await conn.run(
      `CREATE TABLE obs_base AS SELECT * FROM (VALUES
        (0, '0', 'plate_a', 'infected', 10.0),
        (1, '1', 'plate_a', 'mock', 50.0),
        (2, '0', 'plate_b', 'infected', 90.0)
      ) AS t(__row_index__, obs_name, _dataset, condition, area)`,
    );
  });
  const workspace = WorkspaceDocumentStore.empty(join(dir, "workspace.json"));
  await workspace.apply(0, [{ op: "add", path: "", value: document(wranglePredicate) }]);
  const datasets = new Map<string, DatasetMountConfig>([
    ["plate_a", { path: "/a.zarr" }],
    ["plate_b", { path: "/b.zarr" }],
  ]);
  return { store, workspace, datasets };
}

async function result(state: Awaited<ReturnType<typeof session>>, nodeId: string, limit = 100) {
  const res = await handleWorkspaceNode(nodeId, new URL(`http://x/?limit=${limit}`), state);
  return { status: res.status, body: (await res.json()) as unknown };
}

describe("GET /api/workspace/nodes/:id", () => {
  test("a view returns the population it displays: compiled SQL, exact count, bounded identities", async () => {
    const state = await session();
    const { body } = await result(state, "count", 1);
    expect(WorkspaceNodeResultSchema.parse(body)).toEqual({
      revision: 1,
      nodeId: "count",
      status: "resolved",
      output: {
        kind: "pred",
        sql: `("condition" = 'infected')`,
        scopeFilter: null,
        count: 2,
        rows: [{ rowIndex: 0, datasetKey: "plate_a", obsName: "0" }],
        truncated: true,
      },
    });
  });

  test("an agent clause in a bound filter scope restricts the node population", async () => {
    const state = await session();
    expect(
      await state.workspace.apply(1, [
        {
          op: "add",
          path: "/state/filter",
          value: { A: { agent: { area: { op: "gt", column: "area", value: 20 } } } },
        },
        { op: "add", path: "/bindings/count", value: { filter: { $bindState: "/filter/A" } } },
      ]),
    ).toEqual({ kind: "accepted", revision: 2 });
    const { body } = await result(state, "count");
    expect(WorkspaceNodeResultSchema.parse(body)).toMatchObject({
      revision: 2,
      output: {
        scopeFilter: '(("area" > 20))',
        count: 1,
        rows: [{ rowIndex: 2, datasetKey: "plate_b", obsName: "0" }],
      },
    });
  });

  test("a later revision is evaluated against the new document", async () => {
    const state = await session();
    await state.workspace.apply(1, [{ op: "remove", path: "/edges/e2" }]);
    const { body } = await result(state, "count");
    expect(WorkspaceNodeResultSchema.parse(body)).toMatchObject({ revision: 2, output: { sql: null, count: 3 } });
  });

  test("plugin nodes the server cannot resolve and unknown ids are reported, not guessed", async () => {
    const state = await session();
    expect((await result(state, "plugin")).body).toEqual({ revision: 1, nodeId: "plugin", status: "unresolved" });
    expect((await result(state, "ghost")).status).toBe(404);
  });

  test("a stacked statement in document SQL is refused and the data survives", async () => {
    const state = await session("1=1); DROP TABLE obs_base; SELECT (1");
    const { body } = await result(state, "wrangle");
    expect(WorkspaceNodeResultSchema.parse(body)).toMatchObject({ status: "error" });
    expect(await state.store.queryJson("SELECT count(*)::INT AS n FROM obs_base")).toEqual([{ n: 3 }]);
  });
});
