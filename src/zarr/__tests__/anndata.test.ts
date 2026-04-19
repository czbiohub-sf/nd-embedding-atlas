/**
 * AnnData class + dual-axis DuckDB ingestion (zarr rework Phase A+B).
 *
 * Fixture: ../ome-atlas-test-data/annotations.zarr — small dense AnnData
 * (~8.3k obs × 768 var). Test is skipped if the fixture is absent so CI
 * environments without the test-data checkout still pass.
 */

import { describe, expect, test } from "bun:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import { AnnData, BunFileStore, ingestDataFrames, LazyDataFrame } from "../index.ts";
import { EmbeddingStore } from "../../server/store.ts";
import { handleMosaicQuery } from "../../server/mosaic.ts";
import type { AnnDataFrame } from "../types.ts";

const FIXTURE = path.resolve(import.meta.dir, "../../../../ome-atlas-test-data/annotations.zarr");
const HAS_FIXTURE = existsSync(FIXTURE);

describe("BunFileStore", () => {
  test("resolves keys under root and returns undefined for missing files", async () => {
    if (!HAS_FIXTURE) return;
    const store = new BunFileStore(FIXTURE);
    // v2 fixture; v3 stores use zarr.json. Probe both so the test is format-agnostic.
    const v2 = await store.get("/.zgroup");
    const v3 = await store.get("/zarr.json");
    const missing = await store.get("/this/does/not/exist");
    const present = v2 ?? v3;
    expect(present).toBeDefined();
    expect((present as Uint8Array).byteLength).toBeGreaterThan(0);
    expect(missing).toBeUndefined();
  });

  test("getRange reads a byte slice", async () => {
    if (!HAS_FIXTURE) return;
    const store = new BunFileStore(FIXTURE);
    const key = (await store.exists("/.zgroup")) ? "/.zgroup" : "/zarr.json";
    const bytes = await store.getRange(key, { offset: 0, length: 8 });
    expect(bytes?.byteLength).toBe(8);
  });
});

describe("AnnData class — symmetric obs/var + toDuckDB", () => {
  test("opens fixture, exposes obs/var DataFrames with correct shape", async () => {
    if (!HAS_FIXTURE) return;
    const adata = await AnnData.open(FIXTURE);
    expect(adata.nObs).toBeGreaterThan(0);
    expect(adata.nVars).toBeGreaterThan(0);
    expect(adata.obs.length).toBe(adata.nObs);
    expect(adata.var.length).toBe(adata.nVars);
    expect(adata.obs.columns.length).toBeGreaterThan(0);
    expect(adata.shape).toEqual([adata.nObs, adata.nVars]);
  });

  test("ingestDataFrames unions columns across datasets with _dataset discriminator", async () => {
    // Synthetic two-DF union: dataset A has (gene, mean), dataset B has (gene, var).
    const dfA = new LazyDataFrame({
      index: ["g1", "g2"],
      columns: new Map<string, number[] | string[]>([
        ["gene", ["g1", "g2"]],
        ["mean", [0.1, 0.2]],
      ]),
      columnOrder: ["gene", "mean"],
      column(n: string): unknown {
        return (this as { columns: Map<string, unknown> }).columns.get(n);
      },
      [Symbol.iterator]() {
        return [][Symbol.iterator]();
      },
    } as unknown as AnnDataFrame);
    const dfB = new LazyDataFrame({
      index: ["g1", "g3"],
      columns: new Map<string, number[] | string[]>([
        ["gene", ["g1", "g3"]],
        ["var", [1.5, 2.5]],
      ]),
      columnOrder: ["gene", "var"],
      column(n: string): unknown {
        return (this as { columns: Map<string, unknown> }).columns.get(n);
      },
      [Symbol.iterator]() {
        return [][Symbol.iterator]();
      },
    } as unknown as AnnDataFrame);

    const db = await DuckDBInstance.create(":memory:");
    const conn = await db.connect();
    try {
      await ingestDataFrames(conn, "test_union", [dfA, dfB], {
        datasetNames: ["A", "B"],
        axis: "var",
        includeNameColumn: true,
      });

      const schema = await conn.runAndReadAll("SELECT column_name FROM (DESCRIBE test_union) ORDER BY column_name");
      const cols = schema.getColumnsJS()[0] as string[];
      expect(cols).toContain("_dataset");
      expect(cols).toContain("__var_index__");
      expect(cols).toContain("var_name");
      expect(cols).toContain("gene");
      expect(cols).toContain("mean");
      expect(cols).toContain("var");

      const count = await conn.runAndReadAll("SELECT COUNT(*) AS n FROM test_union");
      expect(Number((count.getRowObjectsJson()[0] as { n: bigint | number }).n)).toBe(4);

      // Global axis index spans both DFs
      const idxRange = await conn.runAndReadAll(
        "SELECT MIN(__var_index__) AS lo, MAX(__var_index__) AS hi FROM test_union",
      );
      const r = idxRange.getRowObjectsJson()[0] as { lo: number | bigint; hi: number | bigint };
      expect(Number(r.lo)).toBe(0);
      expect(Number(r.hi)).toBe(3);
    } finally {
      conn.closeSync();
      db.closeSync();
    }
  });

  test("Fix 1: obs_base carries both __row_index__ and __obs_index__ (dual-name)", async () => {
    const store = await EmbeddingStore.fromInit(async (conn) => {
      await conn.run(
        `CREATE TABLE obs_base AS SELECT * FROM (VALUES (0, 'o_0'), (1, 'o_1'), (2, 'o_2')) AS t(placeholder, obs_name)`,
      );
    });
    try {
      const schema = await store.conn.runAndReadAll(
        "SELECT column_name FROM (DESCRIBE obs_base) WHERE column_name IN ('__row_index__', '__obs_index__', 'obs_name')",
      );
      const names = (schema.getColumnsJS()[0] as string[]).slice().sort((a: string, b: string) => a.localeCompare(b));
      expect(names).toEqual(["__obs_index__", "__row_index__", "obs_name"]);

      // Values match between the two index columns
      const match = await store.conn.runAndReadAll(
        "SELECT COUNT(*) AS n FROM obs_base WHERE __row_index__ = __obs_index__",
      );
      expect(Number((match.getRowObjectsJson()[0] as { n: bigint | number }).n)).toBe(3);
    } finally {
      store.close();
    }
  });

  test("Fix 2: var_base gets var_uid generated column and composite index (multi-dataset)", async () => {
    const store = await EmbeddingStore.fromInit(
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
      // var_uid is exposed on the `var` VIEW (not the underlying table).
      const uids = await store.conn.runAndReadAll("SELECT var_uid FROM var ORDER BY __var_index__");
      const values = (uids.getColumnsJS()[0] as string[]).slice().sort((a: string, b: string) => a.localeCompare(b));
      expect(values).toEqual(["ds1::geneA", "ds1::geneB", "ds2::geneA"]);

      // Same var_name across datasets is allowed (not uniquely indexed)
      const dupes = await store.conn.runAndReadAll("SELECT COUNT(*) AS n FROM var_base WHERE var_name = 'geneA'");
      expect(Number((dupes.getRowObjectsJson()[0] as { n: bigint | number }).n)).toBe(2);

      // var_uid distinguishes them
      const byUid = await store.conn.runAndReadAll("SELECT COUNT(DISTINCT var_uid) AS n FROM var");
      expect(Number((byUid.getRowObjectsJson()[0] as { n: bigint | number }).n)).toBe(3);
    } finally {
      store.close();
    }
  });

  test("Mosaic protocol can query var axis via handleMosaicQuery (json + arrow + exec)", async () => {
    const store = await EmbeddingStore.fromInit(
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
      // 1. json — targeted SELECT against var_base. Same path as /data/query.
      const r1 = await handleMosaicQuery(
        {
          type: "json",
          sql: "SELECT COUNT(*) AS n FROM var_base WHERE mean > 0.1",
        },
        store,
      );
      expect(r1.status).toBe(200);
      const j1 = (await r1.json()) as { n: number | bigint }[];
      expect(Number(j1[0].n)).toBe(3);

      // 2. json — Mosaic aggregate pattern (the kind a var-axis panel would emit)
      const r2 = await handleMosaicQuery(
        {
          type: "json",
          sql: "SELECT _dataset, COUNT(*) FILTER (WHERE highly_variable) AS n_hv FROM var_base GROUP BY _dataset ORDER BY _dataset",
        },
        store,
      );
      expect(r2.status).toBe(200);
      const j2 = (await r2.json()) as { _dataset: string; n_hv: number | bigint }[];
      expect(j2).toHaveLength(2);
      expect(j2[0]._dataset).toBe("ds1");
      expect(Number(j2[0].n_hv)).toBe(1);
      expect(Number(j2[1].n_hv)).toBe(1);

      // 3. json — var VIEW with generated var_uid (the collision-safe key)
      const r3 = await handleMosaicQuery(
        {
          type: "json",
          sql: "SELECT var_uid FROM var ORDER BY var_uid",
        },
        store,
      );
      expect(r3.status).toBe(200);
      const j3 = (await r3.json()) as { var_uid: string }[];
      expect(j3.map((r) => r.var_uid)).toEqual(["ds1::geneA", "ds1::geneB", "ds2::geneA", "ds2::geneC"]);

      // 4. arrow — Mosaic's default result format for scatter/chart bindings.
      // nanoarrow extension is optional; if it's not loaded, the server errors
      // gracefully instead of silently returning junk.
      const r4 = await handleMosaicQuery(
        {
          type: "arrow",
          sql: "SELECT __var_index__, var_name, mean FROM var_base WHERE mean > 0.1",
        },
        store,
      );
      if (r4.status === 200) {
        expect(r4.headers.get("Content-Type")).toBe("application/vnd.apache.arrow.stream");
        const buf = await r4.arrayBuffer();
        expect(buf.byteLength).toBeGreaterThan(0);
      } else {
        // nanoarrow wasn't loaded in this env — acceptable
        const e = (await r4.json()) as { error: string };
        expect(e.error).toMatch(/nanoarrow/i);
      }

      // 5. exec — Mosaic pre-aggregation creates cached scratch tables.
      // The SQL allow-list permits "CREATE TABLE" so preagg_* paths work.
      const r5 = await handleMosaicQuery(
        {
          type: "exec",
          sql: "CREATE TABLE mosaic_preagg_vartest AS SELECT _dataset, AVG(mean) AS m FROM var_base GROUP BY _dataset",
        },
        store,
      );
      expect(r5.status).toBe(200);

      const r6 = await handleMosaicQuery(
        { type: "json", sql: "SELECT * FROM mosaic_preagg_vartest ORDER BY _dataset" },
        store,
      );
      expect(r6.status).toBe(200);
      const j6 = (await r6.json()) as { _dataset: string; m: number }[];
      expect(j6).toHaveLength(2);

      // 6. Cross-axis symmetry — same Mosaic protocol works against obs VIEW.
      const r7 = await handleMosaicQuery({ type: "json", sql: "SELECT COUNT(*) AS n FROM dataset" }, store);
      expect(r7.status).toBe(200);
    } finally {
      store.close();
    }
  });

  test("toDuckDB registers both obs_base and var_base queryable standalone", async () => {
    if (!HAS_FIXTURE) return;
    const adata = await AnnData.open(FIXTURE);
    const db = await DuckDBInstance.create(":memory:");
    const conn = await db.connect();
    try {
      await adata.toDuckDB(conn);

      const obsReader = await conn.runAndReadAll("SELECT COUNT(*) AS n FROM obs_base");
      const obsCount = Number((obsReader.getRowObjectsJson()[0] as { n: number | bigint }).n);
      expect(obsCount).toBe(adata.nObs);

      const varReader = await conn.runAndReadAll("SELECT COUNT(*) AS n FROM var_base");
      const varCount = Number((varReader.getRowObjectsJson()[0] as { n: number | bigint }).n);
      expect(varCount).toBe(adata.nVars);

      // Identity columns present and indexed
      const obsSchema = await conn.runAndReadAll(
        "SELECT column_name FROM (DESCRIBE obs_base) WHERE column_name IN ('__obs_index__', 'obs_name')",
      );
      expect(obsSchema.getRowObjectsJson().length).toBe(2);

      const varSchema = await conn.runAndReadAll(
        "SELECT column_name FROM (DESCRIBE var_base) WHERE column_name IN ('__var_index__', 'var_name')",
      );
      expect(varSchema.getRowObjectsJson().length).toBe(2);
    } finally {
      conn.closeSync();
      db.closeSync();
    }
  });
});
