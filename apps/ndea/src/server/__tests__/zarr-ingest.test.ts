import { describe, expect, test } from "bun:test";
import { handleMosaicQuery } from "../mosaic.ts";
import { DatasetQuerySession } from "../store.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new TypeError("Expected an array of records");
  }
  return value;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value === "number" || typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  throw new TypeError(`Expected ${key} to be numeric`);
}

describe("Zarr ingestion integration", () => {
  test("obs_base carries both row index names", async () => {
    const store = await DatasetQuerySession.fromInit(async (conn) => {
      await conn.run(
        `CREATE TABLE obs_base AS SELECT * FROM (VALUES (0, 'o_0'), (1, 'o_1'), (2, 'o_2')) AS t(placeholder, obs_name)`,
      );
    });
    try {
      const schema = await store.conn.runAndReadAll(
        "SELECT column_name FROM (DESCRIBE obs_base) WHERE column_name IN ('__row_index__', '__obs_index__', 'obs_name')",
      );
      const names = schema.getColumnsJS()[0];
      if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) {
        throw new TypeError("Expected string column names");
      }
      expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual(["__obs_index__", "__row_index__", "obs_name"]);

      const match = await store.conn.runAndReadAll(
        "SELECT COUNT(*) AS n FROM obs_base WHERE __row_index__ = __obs_index__",
      );
      const rows = records(match.getRowObjectsJson());
      expect(numberField(rows[0] ?? {}, "n")).toBe(3);
    } finally {
      store.close();
    }
  });

  test("var view generates collision-safe identifiers", async () => {
    const store = await DatasetQuerySession.fromInit(
      async (conn) => {
        await conn.run(`CREATE TABLE obs_base AS SELECT * FROM (VALUES (0, 'o_0')) AS t(x, obs_name)`);
      },
      {
        initVar: async (conn) => {
          await conn.run(`CREATE TABLE var_base (
                        __var_index__ INTEGER,
                        var_name VARCHAR,
                        _dataset VARCHAR
                    )`);
          await conn.run(`INSERT INTO var_base VALUES (0, 'geneA', 'ds1'), (1, 'geneA', 'ds2'), (2, 'geneB', 'ds1')`);
        },
      },
    );
    try {
      const uidResult = await store.conn.runAndReadAll("SELECT var_uid FROM var ORDER BY __var_index__");
      const uids = uidResult.getColumnsJS()[0];
      if (!Array.isArray(uids) || !uids.every((uid) => typeof uid === "string")) {
        throw new TypeError("Expected string var identifiers");
      }
      expect(uids.toSorted((a, b) => a.localeCompare(b))).toEqual(["ds1::geneA", "ds1::geneB", "ds2::geneA"]);

      const duplicateResult = await store.conn.runAndReadAll(
        "SELECT COUNT(*) AS n FROM var_base WHERE var_name = 'geneA'",
      );
      expect(numberField(records(duplicateResult.getRowObjectsJson())[0] ?? {}, "n")).toBe(2);

      const distinctResult = await store.conn.runAndReadAll("SELECT COUNT(DISTINCT var_uid) AS n FROM var");
      expect(numberField(records(distinctResult.getRowObjectsJson())[0] ?? {}, "n")).toBe(3);
    } finally {
      store.close();
    }
  });

  test("Mosaic queries both ingested axes", async () => {
    const store = await DatasetQuerySession.fromInit(
      async (conn) => {
        await conn.run(`CREATE TABLE obs_base AS SELECT * FROM (VALUES (0, 'o_0')) AS t(x, obs_name)`);
      },
      {
        initVar: async (conn) => {
          await conn.run(`CREATE TABLE var_base (
                        __var_index__ INTEGER,
                        var_name VARCHAR,
                        _dataset VARCHAR,
                        mean DOUBLE,
                        highly_variable BOOLEAN
                    )`);
          await conn.run(`INSERT INTO var_base VALUES
                        (0, 'geneA', 'ds1', 0.15, TRUE),
                        (1, 'geneB', 'ds1', 0.42, FALSE),
                        (2, 'geneA', 'ds2', 0.31, TRUE),
                        (3, 'geneC', 'ds2', 0.08, FALSE)
                    `);
        },
      },
    );
    try {
      const countResponse = await handleMosaicQuery(
        { type: "json", sql: "SELECT COUNT(*) AS n FROM var_base WHERE mean > 0.1" },
        store,
      );
      expect(countResponse.status).toBe(200);
      expect(numberField(records(await countResponse.json())[0] ?? {}, "n")).toBe(3);

      const aggregateResponse = await handleMosaicQuery(
        {
          type: "json",
          sql: "SELECT _dataset, COUNT(*) FILTER (WHERE highly_variable) AS n_hv FROM var_base GROUP BY _dataset ORDER BY _dataset",
        },
        store,
      );
      expect(aggregateResponse.status).toBe(200);
      const aggregates = records(await aggregateResponse.json());
      expect(aggregates).toHaveLength(2);
      expect(aggregates[0]?.["_dataset"]).toBe("ds1");
      expect(numberField(aggregates[0] ?? {}, "n_hv")).toBe(1);
      expect(numberField(aggregates[1] ?? {}, "n_hv")).toBe(1);

      const uidResponse = await handleMosaicQuery(
        { type: "json", sql: "SELECT var_uid FROM var ORDER BY var_uid" },
        store,
      );
      expect(uidResponse.status).toBe(200);
      expect(records(await uidResponse.json()).map((row) => row["var_uid"])).toEqual([
        "ds1::geneA",
        "ds1::geneB",
        "ds2::geneA",
        "ds2::geneC",
      ]);

      const arrowResponse = await handleMosaicQuery(
        {
          type: "arrow",
          sql: "SELECT __var_index__, var_name, mean FROM var_base WHERE mean > 0.1",
        },
        store,
      );
      if (arrowResponse.status === 200) {
        expect(arrowResponse.headers.get("Content-Type")).toBe("application/vnd.apache.arrow.stream");
        expect((await arrowResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
      } else {
        const error = await arrowResponse.json();
        if (!isRecord(error) || typeof error["error"] !== "string") {
          throw new TypeError("Expected a Mosaic error response");
        }
        expect(error["error"]).toMatch(/nanoarrow/i);
      }

      const createResponse = await handleMosaicQuery(
        {
          type: "exec",
          sql: "CREATE TABLE mosaic_preagg_vartest AS SELECT _dataset, AVG(mean) AS m FROM var_base GROUP BY _dataset",
        },
        store,
      );
      expect(createResponse.status).toBe(200);

      const preaggregateResponse = await handleMosaicQuery(
        { type: "json", sql: "SELECT * FROM mosaic_preagg_vartest ORDER BY _dataset" },
        store,
      );
      expect(preaggregateResponse.status).toBe(200);
      expect(records(await preaggregateResponse.json())).toHaveLength(2);

      const obsResponse = await handleMosaicQuery({ type: "json", sql: "SELECT COUNT(*) AS n FROM dataset" }, store);
      expect(obsResponse.status).toBe(200);
    } finally {
      store.close();
    }
  });
});
