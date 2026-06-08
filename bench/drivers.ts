/**
 * Bench drivers — the swappable I/O backend seam (CYCLE workflow, seam A).
 *
 * Each driver builds a ready `EmbeddingStore` from a source, the SAME way the
 * real startup path does, so the harness measures genuine behavior. Cycles add
 * one driver at a time and A/B them on the identical query suite.
 *
 *   memory-table   zarr → Arrow IPC → :memory:  (baseline, the startup path)
 *   parquet        parquet → :memory:           (baseline, fromParquet)
 *   file-table     zarr → Arrow IPC → file-backed DuckDB + memory_limit  (Cycle 1a)
 *   parquet-file   parquet → file-backed DuckDB + memory_limit           (Cycle 1a)
 *
 * file-backed drivers pass `dbPath`/`pragmas` through the new `StoreOpenOptions`
 * seam on `EmbeddingStore` (default behavior unchanged). MuData is handled: its
 * obs is collision-merged across modalities and var unioned via
 * `MuData.toDuckDB`, mirroring `cli/startup.ts`.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import {
  AnnData,
  ingestDataFrameChunked,
  ingestDataFrames,
  ingestDataFramesStreaming,
  MuData,
  open,
  openBunStore,
} from "../src/zarr/index.ts";
import { EmbeddingStore, type StoreOpenOptions } from "../src/server/store.ts";

export interface BuiltStore {
  store: EmbeddingStore;
  nObs: number;
  nCols: number;
}

export interface BenchDriver {
  readonly id: string;
  /** Build a ready store from a source path (zarr dir or parquet file). */
  build(source: string): Promise<BuiltStore>;
}

/** Count columns on the queryable `dataset` VIEW. */
async function describeCols(store: EmbeddingStore): Promise<number> {
  const reader = await store.conn.runAndReadAll("SELECT COUNT(*) AS n FROM (DESCRIBE dataset)");
  return Number(reader.getRowObjectsJson()[0].n);
}

/** File-backed open options — forces out-of-core paging under a 1 GB cap. */
function fileBacked(tag: string): StoreOpenOptions {
  return {
    dbPath: join(tmpdir(), `ndea-bench-${tag}-${process.pid}.duckdb`),
    pragmas: { memoryLimit: "1GB", threads: 4 },
  };
}

/** AnnData obs/var ingest — `ingestDataFrames` (Arrow) or its streaming variant. */
type Ingest = typeof ingestDataFrames;

/** Open a zarr store and ingest obs/var the way startup does (AnnData + MuData). */
async function buildZarr(
  source: string,
  options?: StoreOpenOptions,
  ingest: Ingest = ingestDataFrames,
): Promise<BuiltStore> {
  const parsed = await open(source);

  let initStore: (conn: DuckDBConnection) => Promise<void>;
  let initVar: ((conn: DuckDBConnection) => Promise<void>) | undefined;
  const name = "bench";

  if (parsed.kind === "mudata") {
    const mu = MuData.from(parsed);
    initStore = async (conn) => {
      await mu.toDuckDB(conn, { skipVar: true });
    };
    initVar = async (conn) => {
      await mu.toDuckDB(conn, { skipObs: true });
    };
  } else if (parsed.kind === "anndata") {
    const ad = AnnData.from(parsed);
    initStore = async (conn) => {
      await ingest(conn, "obs_base", [ad.obs], { datasetNames: [name], axis: "obs", includeNameColumn: true });
    };
    initVar = async (conn) => {
      await ingest(conn, "var_base", [ad.var], { datasetNames: [name], axis: "var", includeNameColumn: true });
    };
  } else {
    throw new Error(`bench: ${source} is ${parsed.kind}, not AnnData/MuData`);
  }

  const store = await EmbeddingStore.fromInit(initStore, { ...options, initVar });
  return { store, nObs: store.nObs, nCols: await describeCols(store) };
}

/** Ingest an obs Parquet directly (`EmbeddingStore.fromParquet`). */
async function buildParquet(source: string, options?: StoreOpenOptions): Promise<BuiltStore> {
  const store = await EmbeddingStore.fromParquet(source, options);
  return { store, nObs: store.nObs, nCols: await describeCols(store) };
}

/**
 * Chunked streaming — opens the zarr store DIRECTLY (bypassing open()/AnnData.from,
 * which materialize the full obs eagerly) and streams obs/var in row-windows so
 * peak JS never holds the whole dataset. AnnData layout only.
 */
async function buildChunked(source: string, options?: StoreOpenOptions): Promise<BuiltStore> {
  const { store } = await openBunStore(source);
  const es = await EmbeddingStore.fromInit(
    async (conn) => {
      await ingestDataFrameChunked(conn, "obs_base", store, "obs", { axis: "obs", includeNameColumn: true });
    },
    {
      ...options,
      initVar: async (conn) => {
        await ingestDataFrameChunked(conn, "var_base", store, "var", { axis: "var", includeNameColumn: true });
      },
    },
  );
  return { store: es, nObs: es.nObs, nCols: await describeCols(es) };
}

export const DRIVERS: Record<string, BenchDriver> = {
  "memory-table": { id: "memory-table", build: (s) => buildZarr(s) },
  parquet: { id: "parquet", build: (s) => buildParquet(s) },
  "file-table": { id: "file-table", build: (s) => buildZarr(s, fileBacked("table")) },
  "parquet-file": { id: "parquet-file", build: (s) => buildParquet(s, fileBacked("parquet")) },
  // Cycle 3: stream from source columns, no Arrow table. :memory: so the delta
  // vs memory-table is purely the streaming ingest (not file-backing).
  "stream-table": { id: "stream-table", build: (s) => buildZarr(s, undefined, ingestDataFramesStreaming) },
  // Cycle 4: both wins stacked — streaming ingest (JS side −90%) + file-backed
  // DuckDB + memory_limit (pages the residual DuckDB-native footprint).
  "stream-file": { id: "stream-file", build: (s) => buildZarr(s, fileBacked("stream"), ingestDataFramesStreaming) },
  // Cycle 5: chunked source streaming — never materialize the whole obs in JS
  // (peak ≈ one row-window). :memory: to isolate the read-path delta.
  "stream-chunked": { id: "stream-chunked", build: (s) => buildChunked(s) },
  // Cycle 5 + out-of-core: chunked source + file-backed DuckDB.
  "stream-chunked-file": { id: "stream-chunked-file", build: (s) => buildChunked(s, fileBacked("chunked")) },
};
