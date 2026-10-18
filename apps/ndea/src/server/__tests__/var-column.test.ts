/**
 * read_zarr ingest (obs_base / var_base) and gene columns, on small stores
 * from the bench's synthetic writer. Expected values come from zarrita reads
 * of the raw arrays, independent of duckdb-zarr.
 */

import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import FileSystemStore from "@zarrita/storage/fs";
import * as zarr from "zarrita";
import { commitObsColumns, openAnnData, openMuData, type DatasetHandle } from "@ndea/zarr";
import { writeAnnData, writeMuData } from "../../../scripts/synthetic-anndata.ts";
import { DatasetQuerySession } from "../store.ts";
import { ingestObs, ingestVar, varColumnQuery, type IngestDataset } from "../zarr-ingest.ts";

const dir = await mkdtemp(join(tmpdir(), "ndea-zarr-ingest-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

const csr = join(dir, "csr.zarr");
const dense = join(dir, "dense.zarr");
const mudata = join(dir, "mudata.zarr");
// ~20 stored entries per row over 2000 vars: gene_5 is stored in a few rows only.
await writeAnnData(csr, { nObs: 300, nVars: 2000 });
await writeAnnData(dense, { nObs: 120, nVars: 40, denseX: true, seed: 3 });
await writeMuData(mudata, { nObs: 100 });

async function session(datasets: IngestDataset[]): Promise<DatasetQuerySession> {
  return DatasetQuerySession.fromInit((conn) => ingestObs(conn, datasets), {
    initVar: (conn) => ingestVar(conn, datasets),
  });
}

async function rows(store: DatasetQuerySession, sql: string): Promise<Record<string, unknown>[]> {
  return store.queryJson(sql);
}

async function rawArray(store: string, path: string): Promise<ArrayLike<number | bigint>> {
  const arr = await zarr.open(zarr.root(new FileSystemStore(store)).resolve(path), { kind: "array" });
  return (await zarr.get(arr)).data as ArrayLike<number | bigint>;
}

/** Column `j` of a CSR X, decoded from its raw arrays. */
async function csrColumn(store: string, j: number): Promise<number[]> {
  const [data, indices, indptr] = await Promise.all(["X/data", "X/indices", "X/indptr"].map((p) => rawArray(store, p)));
  const out: number[] = [];
  for (let i = 0; i + 1 < indptr.length; i++) {
    let v = 0;
    for (let p = Number(indptr[i]); p < Number(indptr[i + 1]); p++) if (Number(indices[p]) === j) v = Number(data[p]);
    out.push(v);
  }
  return out;
}

async function geneColumn(store: DatasetQuerySession, datasets: IngestDataset[], name: string): Promise<unknown[]> {
  const { query, scratch } = await varColumnQuery(store.conn, datasets, { name, layer: "X" });
  await store.registerVarColumn("__gene__", query);
  for (const table of scratch) await store.execute(`DROP TABLE ${table}`);
  return (await rows(store, `SELECT "__gene__" AS v FROM dataset ORDER BY __row_index__`)).map((r) => r.v);
}

test("a single store: obs/var in store order, declared types, row index identity", async () => {
  const adata = await openAnnData(csr);
  const store = await session([{ name: "csr", handle: adata }]);
  try {
    const [check] = await rows(
      store,
      `SELECT count(*) AS n, count(*) FILTER (WHERE obs_name <> 'cell_' || __obs_index__ OR _index <> obs_name OR __row_index__ <> __obs_index__) AS bad FROM obs_base`,
    );
    expect(check).toEqual({ n: 300, bad: 0 });
    const types = Object.fromEntries(
      (await rows(store, "SELECT column_name AS c, column_type AS t FROM (DESCRIBE obs_base)")).map((r) => [r.c, r.t]),
    );
    expect(types.sample).toBe("VARCHAR");
    expect(types.is_doublet).toBe("BOOLEAN");
    expect(types.age).toBe("INTEGER");
    expect(types.total_umis).toBe("BIGINT");
    expect(Object.keys(types).slice(0, 3)).toEqual(["__obs_index__", "obs_name", "_index"]);
    expect(Object.keys(types).at(-1)).toBe("__row_index__");
    // No ENUM reaches a table: nanoarrow's Arrow IPC path fails fatally on dictionaries.
    expect((await store.queryArrow("SELECT * FROM dataset LIMIT 5")).byteLength).toBeGreaterThan(0);
    // Categorical code -1 and masked nullable values are NULL.
    const [nulls] = await rows(
      store,
      "SELECT count(*) - count(cell_type) AS cell_type, count(*) - count(age) AS age FROM obs_base",
    );
    expect(Number(nulls.cell_type)).toBeGreaterThan(0);
    expect(Number(nulls.age)).toBeGreaterThan(0);
    const [names] = await rows(
      store,
      "SELECT count(*) AS n, count(*) FILTER (WHERE var_name <> 'gene_' || __var_index__) AS bad FROM var_base",
    );
    expect(names).toEqual({ n: 2000, bad: 0 });
  } finally {
    store.close();
  }
});

test("a CSR gene column has the stored values at their rows and 0 elsewhere", async () => {
  const datasets = [{ name: "csr", handle: await openAnnData(csr) }];
  const store = await session(datasets);
  try {
    const expected = await csrColumn(csr, 5);
    expect(expected.some((v) => v === 0)).toBe(true);
    expect(expected.some((v) => v !== 0)).toBe(true);
    expect(await geneColumn(store, datasets, "gene_5")).toEqual(expected);
  } finally {
    store.close();
  }
});

test("a union stacks stores under _dataset; a gene column spans a CSR and a dense store", async () => {
  const datasets: IngestDataset[] = [
    { name: "a", handle: await openAnnData(csr) },
    { name: "b", handle: await openAnnData(dense) },
  ];
  const store = await session(datasets);
  try {
    const counts = await rows(
      store,
      "SELECT _dataset AS d, min(__obs_index__) AS lo, max(__obs_index__) AS hi FROM obs_base GROUP BY 1 ORDER BY 1",
    );
    expect(counts).toEqual([
      { d: "a", lo: 0, hi: 299 },
      { d: "b", lo: 300, hi: 419 },
    ]);
    const x = await rawArray(dense, "X");
    const denseColumn = Array.from({ length: 120 }, (_, i) => Number(x[i * 40 + 5]));
    expect(await geneColumn(store, datasets, "gene_5")).toEqual([...(await csrColumn(csr, 5)), ...denseColumn]);
  } finally {
    store.close();
  }
});

test("MuData: root obs, then modality columns (prefixed on collision); var tagged by _modality", async () => {
  const handle: DatasetHandle = await openMuData(mudata);
  const store = await session([{ name: "m", handle }]);
  try {
    const columns = (await rows(store, "SELECT column_name AS c FROM (DESCRIBE obs_base)")).map((r) => r.c);
    expect(columns.slice(0, 6)).toEqual([
      "__obs_index__",
      "obs_name",
      "_index",
      "sample",
      "rna_n_genes",
      "global_score",
    ]);
    expect(columns).toContain("prot:sample");
    expect(columns).toContain("rna:n_genes");
    const modalities = await rows(store, "SELECT _modality AS m, count(*) AS n FROM var_base GROUP BY 1 ORDER BY 1");
    expect(modalities).toEqual([
      { m: "__shared__", n: 2030 },
      { m: "prot", n: 30 },
      { m: "rna", n: 2000 },
    ]);
  } finally {
    store.close();
  }
});

test("columns written by commitObsColumns read back through read_zarr", async () => {
  const path = join(dir, "written.zarr");
  await writeAnnData(path, { nObs: 6, nVars: 4 });
  await commitObsColumns(path, [
    {
      name: "label",
      kind: "categorical",
      values: new Map([
        ["cell_0", "T cell"],
        ["cell_2", "B cell"],
      ]),
    },
  ]);
  const store = await session([{ name: "w", handle: await openAnnData(path) }]);
  try {
    const labels = (await rows(store, "SELECT CAST(label AS VARCHAR) AS v FROM obs_base ORDER BY __obs_index__")).map(
      (r) => r.v,
    );
    expect(labels).toEqual(["T cell", null, "B cell", null, null, null]);
  } finally {
    store.close();
  }
});
