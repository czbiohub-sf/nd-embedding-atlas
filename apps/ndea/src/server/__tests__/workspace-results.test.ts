import { afterEach, describe, expect, test } from "bun:test";
import type { DuckDBConnection } from "@duckdb/node-api";
import { handleWorkspaceResult } from "../routes/workspace.ts";
import type { ServerSession } from "../state.ts";
import { DatasetQuerySession } from "../store.ts";
import { Workspace } from "../workspace.ts";

const filterA = { $bindState: "/filter/A" };

function document(largeSql = "area > 20") {
  return {
    data: {
      infected: { where: { op: "eq", column: "condition", value: "infected" } },
      large: { from: "infected", sql: largeSql },
    },
    spec: {
      root: "root",
      elements: {
        root: { type: "stack", props: {}, children: ["count", "table", "title"] },
        count: { type: "count", props: { data: "infected", filter: filterA }, children: [] },
        table: { type: "table", props: { filter: filterA }, children: [] },
        title: { type: "text", props: { text: "Cells" }, children: [] },
      },
    },
    // The table publishes a brush; every other member of A sees it, the table does not.
    state: { filter: { A: { table: { area: { op: "gt", column: "area", value: 20 } } } } },
  };
}

let store: DatasetQuerySession | null = null;
afterEach(() => {
  store?.close();
  store = null;
});

async function session(largeSql?: string) {
  store = await DatasetQuerySession.fromInit(async (conn: DuckDBConnection) => {
    await conn.run(
      `CREATE TABLE obs_base AS SELECT * FROM (VALUES
        (0, '0', 'plate_a', 'infected', 10.0),
        (1, '1', 'plate_a', 'mock', 50.0),
        (2, '0', 'plate_b', 'infected', 90.0)
      ) AS t(__row_index__, obs_name, _dataset, condition, area)`,
    );
  });
  const workspace = Workspace.memory();
  expect(
    await workspace.patch([{ op: "add", path: "", value: document(largeSql) }], { base: 0, actor: { kind: "cli" } }),
  ).toMatchObject({ kind: "accepted" });
  return { store, workspace };
}

async function result(
  state: Pick<ServerSession, "workspace" | "store">,
  target: { element: string } | { data: string },
) {
  const res = await handleWorkspaceResult(target, state);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function directCount(where: string): Promise<number> {
  const [row] = await store!.queryJson(`SELECT count(*)::INT AS n FROM dataset WHERE ${where}`);
  return Number(row.n);
}

describe("GET /api/workspace/elements/:id and /data/:name", () => {
  test("an element counts its data source AND the other members' clauses, never its own", async () => {
    const state = await session();
    const count = await result(state, { element: "count" });
    expect(count.status).toBe(200);
    expect(count.body).toMatchObject({ revision: 1, count: await directCount("condition = 'infected' AND area > 20") });
    expect(count.body.count).toBe(1);

    const table = await result(state, { element: "table" });
    expect(table.body).toEqual({ revision: 1, predicate: null, count: 3 });
  });

  test("a data source evaluates its whole `from` chain", async () => {
    const state = await session();
    const { status, body } = await result(state, { data: "large" });
    expect(status).toBe(200);
    expect(body.count).toBe(await directCount("condition = 'infected' AND area > 20"));
    expect(body.predicate).toContain("area > 20");
  });

  test("unknown ids are 404s; layout and text elements read no data", async () => {
    const state = await session();
    expect((await result(state, { element: "ghost" })).status).toBe(404);
    expect((await result(state, { data: "ghost" })).status).toBe(404);
    expect((await result(state, { element: "title" })).status).toBe(400);
  });

  test("a stacked statement in document SQL is refused and the data survives", async () => {
    const state = await session("1=1); DROP TABLE obs_base; SELECT (1");
    const { status, body } = await result(state, { data: "large" });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(body.error).toBeString();
    expect(await state.store.queryJson("SELECT count(*)::INT AS n FROM obs_base")).toEqual([{ n: 3 }]);
  });
});
