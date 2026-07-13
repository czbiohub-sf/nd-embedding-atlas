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
import { BunFileStore, ingestDataFrames, LazyDataFrame, openAnnData } from "../index.ts";
import { SimpleNullable } from "../helpers.ts";
import type { AnnDataFrame } from "../types.ts";

const FIXTURE = path.resolve(import.meta.dir, "../../../../../ome-atlas-test-data/annotations.zarr");
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
    const adata = await openAnnData(FIXTURE);
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

  test("ingestDataFrames reads obs_name from a nullable-string-array index (not empty)", async () => {
    // Regression: a `nullable-string-array` index arrives as a SimpleNullable
    // wrapper whose values are reachable only via `.at()` — raw `idx[r]` is
    // undefined. The name-column emission used `idx[r]`, so obs_name became ""
    // for every row, and annotation write-back (aligns by obs_name) then wrote
    // an all-NA column.
    const labels = ["c0", "c1", "c2"];
    const df = new LazyDataFrame({
      index: new SimpleNullable(labels, new Uint8Array(labels.length)), // mask all 0 = all valid
      columns: new Map<string, number[]>([["score", [0.1, 0.2, 0.3]]]),
      columnOrder: ["score"],
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
      await ingestDataFrames(conn, "t_nullable_idx", [df], { axis: "obs", includeNameColumn: true });
      const rows = (
        await conn.runAndReadAll("SELECT obs_name FROM t_nullable_idx ORDER BY __obs_index__")
      ).getColumnsJS()[0] as string[];
      expect(rows).toEqual(labels); // was ["", "", ""] before the fix
    } finally {
      conn.closeSync();
      db.closeSync();
    }
  });

  test("toDuckDB registers both obs_base and var_base queryable standalone", async () => {
    if (!HAS_FIXTURE) return;
    const adata = await openAnnData(FIXTURE);
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
