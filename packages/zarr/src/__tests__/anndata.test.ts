/**
 * AnnData class + dual-axis DuckDB ingestion (zarr rework Phase A+B).
 *
 * Fixture: ../ome-atlas-test-data/annotations.zarr: small dense AnnData
 * (~8.3k obs × 768 var). Test is skipped if the fixture is absent so CI
 * environments without the test-data checkout still pass.
 */

import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";
import { BunFileStore, ingestDataFrames, LazyDataFrame, open, openAnnData, openMuData } from "../index.ts";
import { SimpleNullable } from "../helpers.ts";
import type { AnnDataFrame } from "../types.ts";
import { vlenEncode } from "../write-obs.ts";

const FIXTURE = path.resolve(import.meta.dir, "../../../../../ome-atlas-test-data/annotations.zarr");
const HAS_FIXTURE = existsSync(FIXTURE);
const TEXT_ENCODER = new TextEncoder();

let temporaryStorePath = "";
afterEach(async () => {
  if (temporaryStorePath) await rm(temporaryStorePath, { recursive: true, force: true });
  temporaryStorePath = "";
});

async function createV2Group(store: BunFileStore, groupPath: string, attrs: Record<string, unknown>): Promise<void> {
  const prefix = groupPath === "/" ? "" : groupPath;
  await store.set(`${prefix}/.zgroup`, TEXT_ENCODER.encode(JSON.stringify({ zarr_format: 2 })));
  await store.set(`${prefix}/.zattrs`, TEXT_ENCODER.encode(JSON.stringify(attrs)));
}

async function createV2StringIndex(store: BunFileStore, dataFramePath: string, names: string[]): Promise<void> {
  const indexPath = `${dataFramePath}/_index`;
  await store.set(
    `${indexPath}/.zarray`,
    TEXT_ENCODER.encode(
      JSON.stringify({
        shape: [names.length],
        chunks: [names.length],
        dtype: "|O",
        fill_value: "",
        filters: [{ id: "vlen-utf8" }],
        order: "C",
        dimension_separator: ".",
        compressor: null,
        zarr_format: 2,
      }),
    ),
  );
  await store.set(
    `${indexPath}/.zattrs`,
    TEXT_ENCODER.encode(JSON.stringify({ "encoding-type": "string-array", "encoding-version": "0.2.0" })),
  );
  await store.set(`${indexPath}/0`, vlenEncode(names));
}

async function createV2DataFrame(store: BunFileStore, dataFramePath: string, names: string[]): Promise<void> {
  await createV2Group(store, dataFramePath, {
    "encoding-type": "dataframe",
    "encoding-version": "0.2.0",
    _index: "_index",
    "column-order": [],
  });
  await createV2StringIndex(store, dataFramePath, names);
}

async function createMuDataFixture(): Promise<BunFileStore> {
  temporaryStorePath = await mkdtemp(path.join(tmpdir(), "ndea-mudata-"));
  const store = new BunFileStore(temporaryStorePath);
  await createV2Group(store, "/", {
    "encoding-type": "MuData",
    "encoding-version": "0.1.0",
    axis: 0,
  });
  await createV2DataFrame(store, "/obs", ["cell_0", "cell_1"]);
  await createV2DataFrame(store, "/var", ["shared_feature"]);
  await createV2Group(store, "/mod", {});
  await createV2Group(store, "/mod/rna", {
    "encoding-type": "anndata",
    "encoding-version": "0.1.0",
  });
  await createV2DataFrame(store, "/mod/rna/obs", ["cell_0", "cell_1"]);
  await createV2DataFrame(store, "/mod/rna/var", ["gene_0", "gene_1"]);
  await createV2Group(store, "/obsmap", {});
  await store.set(
    "/obsmap/rna/.zarray",
    TEXT_ENCODER.encode(
      JSON.stringify({
        shape: [2],
        chunks: [2],
        dtype: "<i4",
        fill_value: 0,
        filters: null,
        order: "C",
        dimension_separator: ".",
        compressor: null,
        zarr_format: 2,
      }),
    ),
  );
  await store.set(
    "/obsmap/rna/.zattrs",
    TEXT_ENCODER.encode(JSON.stringify({ "encoding-type": "array", "encoding-version": "0.2.0" })),
  );
  await store.set("/obsmap/rna/0", new Uint8Array(new Int32Array([0, 1]).buffer));
  return store;
}

async function createOmeZarrFixture() {
  temporaryStorePath = await mkdtemp(path.join(tmpdir(), "ndea-ome-zarr-"));
  const store = new BunFileStore(temporaryStorePath);
  const attrs = {
    multiscales: [
      {
        version: "0.4",
        axes: [
          { name: "t", type: "time" },
          { name: "c", type: "channel" },
          { name: "z", type: "space" },
          { name: "y", type: "space" },
          { name: "x", type: "space" },
        ],
        datasets: [{ path: "0" }],
      },
    ],
    omero: { channels: [{ label: "DAPI" }] },
  };
  await createV2Group(store, "/", attrs);
  return { store, attrs };
}

describe("BunFileStore", () => {
  test("normalizes only trailing path separators", () => {
    expect(new BunFileStore("/tmp/data///").root).toBe("/tmp/data");
    expect(new BunFileStore("/tmp////data").root).toBe("/tmp////data");
    expect(new BunFileStore("/").root).toBe("");
  });

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

describe("Zarr convention vocabulary through the package barrel", () => {
  test("MuData retains its discriminant, axis, modality key, and obsmap", async () => {
    const store = await createMuDataFixture();
    const parsed = await open(store);

    expect(parsed.kind).toBe("mudata");
    if (parsed.kind !== "mudata") throw new Error(`Expected MuData, received ${parsed.kind}`);
    expect(parsed.attrs).toMatchObject({
      "encoding-type": "MuData",
      "encoding-version": "0.1.0",
      axis: 0,
    });
    expect([...parsed.modalities.keys()]).toEqual(["rna"]);
    expect(Array.from(parsed.obsmap.get("rna") ?? [])).toEqual([0, 1]);

    const mdata = await openMuData(store);
    expect(mdata.kind).toBe("mudata");
    expect(mdata.axis).toBe(0);
    expect(mdata.modNames).toEqual(["rna"]);
    expect(mdata.obs.indexName).toBe("obs_name");
    expect(mdata.var.indexName).toBe("var_name");
    expect(mdata.mod.get("rna")?.obs.index).toEqual(["cell_0", "cell_1"]);
    expect(mdata.mod.get("rna")?.var.index).toEqual(["gene_0", "gene_1"]);
  });

  test("OME-Zarr retains its discriminant, TCZYX axes, and metadata attributes", async () => {
    const { store, attrs } = await createOmeZarrFixture();
    const parsed = await open(store);

    expect(parsed.kind).toBe("ome-zarr");
    if (parsed.kind !== "ome-zarr") throw new Error(`Expected OME-Zarr, received ${parsed.kind}`);
    expect(parsed.attrs).toEqual(attrs);
    expect(parsed.multiscales).toEqual(attrs.multiscales);
    const axes = (parsed.multiscales[0] as { axes: { name: string }[] }).axes.map(({ name }) => name);
    expect(axes).toEqual(["t", "c", "z", "y", "x"]);
  });
});

describe("AnnData class: symmetric obs/var + toDuckDB", () => {
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
    // wrapper whose values are reachable only via `.at()`: raw `idx[r]` is
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
