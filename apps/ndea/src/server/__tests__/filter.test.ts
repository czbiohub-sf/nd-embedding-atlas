import { afterEach, describe, expect, test } from "bun:test";
import type { DuckDBConnection } from "@duckdb/node-api";
import { FilterResponseSchema } from "@ndea/protocol";
import { handleFilter } from "../routes/filter.ts";
import type { DatasetMountConfig } from "../state.ts";
import { DatasetQuerySession } from "../store.ts";

/** Two datasets that reuse obs names, as real multi-plate unions do. */
function createStore(): Promise<DatasetQuerySession> {
  return DatasetQuerySession.fromInit(async (conn: DuckDBConnection) => {
    await conn.run(
      `CREATE TABLE obs_base AS SELECT * FROM (VALUES
        (0, '0', 'plate_a', 'infected', 10.0),
        (1, '1', 'plate_a', 'mock', 50.0),
        (2, '0', 'plate_b', 'infected', 90.0),
        (3, '1', 'plate_b', 'o''hara', 70.0)
      ) AS t(__row_index__, obs_name, _dataset, condition, area)`,
    );
  });
}

let store: DatasetQuerySession | null = null;
afterEach(() => {
  store?.close();
  store = null;
});

async function post(body: unknown) {
  store ??= await createStore();
  const datasets = new Map<string, DatasetMountConfig>([
    ["plate_a", { path: "/a.zarr" }],
    ["plate_b", { path: "/b.zarr" }],
  ]);
  const req = new Request("http://x/api/filter", { method: "POST", body: JSON.stringify(body) });
  return handleFilter(req, { store, datasets });
}

describe("POST /api/filter", () => {
  test("returns dataset-qualified identity for obs names shared across datasets", async () => {
    const res = await post({
      where: {
        op: "and",
        clauses: [
          { op: "eq", column: "condition", value: "infected" },
          { op: "gt", column: "area", value: 5 },
        ],
      },
    });
    const body = FilterResponseSchema.parse(await res.json());
    expect(body.count).toBe(2);
    expect(body.rows).toEqual([
      { rowIndex: 0, datasetKey: "plate_a", obsName: "0" },
      { rowIndex: 2, datasetKey: "plate_b", obsName: "0" },
    ]);
    expect(body.truncated).toBe(false);
  });

  test("matches string literals containing quotes exactly", async () => {
    const body = FilterResponseSchema.parse(
      await (await post({ where: { op: "in", column: "condition", values: ["o'hara"] } })).json(),
    );
    expect(body.rows.map((row) => row.rowIndex)).toEqual([3]);
  });

  test("null where selects everything; limit truncates rows but not count", async () => {
    const body = FilterResponseSchema.parse(await (await post({ where: null, limit: 1 })).json());
    expect(body).toMatchObject({ sql: null, count: 4, truncated: true });
    expect(body.rows).toHaveLength(1);
  });

  test("rejects raw SQL and malformed clauses before execution", async () => {
    expect((await post({ where: "area > 0" })).status).toBe(400);
    expect((await post({ where: { op: "in", column: "area", values: [] } })).status).toBe(400);
    expect((await post({ where: { op: "and", clauses: [] } })).status).toBe(400);
  });

  test("reports unknown columns as a client error with the compiled SQL", async () => {
    const res = await post({ where: { op: "gt", column: "nope", value: 1 } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; sql: string };
    expect(body.sql).toBe('("nope" > 1)');
    expect(body.error).toContain("nope");
  });
});
