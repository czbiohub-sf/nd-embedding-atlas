/**
 * Bench drivers — the swappable I/O backend seam (CYCLE workflow, seam A).
 *
 * Each driver builds a ready `EmbeddingStore` from a source, the SAME way the
 * real startup path does, so the harness measures genuine behavior. Cycles add
 * one driver at a time and A/B them on the identical query suite.
 *
 * Cycle 0 ships the two existing `:memory:` factories as drivers (the baseline
 * family). Cycle 1 will introduce a file-backed driver — at which point this
 * seam converges with a production `ObsBackend` param on `EmbeddingStore`.
 *
 * MuData is handled: its obs is collision-merged across modalities and var is
 * unioned via `MuData.toDuckDB`, mirroring `cli/startup.ts`.
 */

import type { DuckDBConnection } from "@duckdb/node-api";
import { AnnData, MuData, ingestDataFrames, open } from "../src/zarr/index.ts";
import { EmbeddingStore } from "../src/server/store.ts";

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

/**
 * memory-table — today's baseline: open zarr → ingest obs/var DataFrames as
 * Arrow IPC into in-memory DuckDB tables (`EmbeddingStore.fromInit`). Mirrors
 * the single-dataset branch of `cli/startup.ts`.
 */
export const memoryTableDriver: BenchDriver = {
  id: "memory-table",
  async build(source) {
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
        await ingestDataFrames(conn, "obs_base", [ad.obs], {
          datasetNames: [name],
          axis: "obs",
          includeNameColumn: true,
        });
      };
      initVar = async (conn) => {
        await ingestDataFrames(conn, "var_base", [ad.var], {
          datasetNames: [name],
          axis: "var",
          includeNameColumn: true,
        });
      };
    } else {
      throw new Error(`bench: ${source} is ${parsed.kind}, not AnnData/MuData`);
    }

    const store = await EmbeddingStore.fromInit(initStore, { initVar });
    return { store, nObs: store.nObs, nCols: await describeCols(store) };
  },
};

/**
 * parquet — ingest an obs Parquet directly (`EmbeddingStore.fromParquet`).
 * Used to measure the synthetic 5M/10M ceiling (see bench/synth.ts). Still the
 * `:memory:` baseline family — bulk obs is materialized into DuckDB.
 */
export const parquetDriver: BenchDriver = {
  id: "parquet",
  async build(source) {
    const store = await EmbeddingStore.fromParquet(source);
    return { store, nObs: store.nObs, nCols: await describeCols(store) };
  },
};

export const DRIVERS: Record<string, BenchDriver> = {
  [memoryTableDriver.id]: memoryTableDriver,
  [parquetDriver.id]: parquetDriver,
};
