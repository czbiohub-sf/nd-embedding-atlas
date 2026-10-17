import { ingestDataFrameChunked, ingestDataFramesStreaming, openBunStore, type MuData } from "@ndea/zarr";
import type { DuckDBConnection } from "@duckdb/node-api";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import {
  ingestCacheKey,
  ingestPragmas,
  isLocalPath,
  resolveIngestCachePath,
  type IngestStrategy,
} from "../../server/ingest-cache.ts";
import { DatasetQuerySession } from "../../server/store.ts";
import { label, num, task } from "../lib/style.ts";
import { VERSION } from "../version.ts";
import type { PreparedDatasets } from "./datasets.ts";

type StoreInitializer = (connection: DuckDBConnection) => Promise<void>;

interface Initializers {
  initStore: StoreInitializer;
  initVar: StoreInitializer;
}

export interface PreparedQuerySession {
  store: DatasetQuerySession;
  cacheEnabled: boolean;
  /** The DuckDB file came from the ingest cache instead of a fresh ingest. */
  cached: boolean;
}

/** Chunked cannot emit the `_dataset` discriminator, so unions must stream. */
export function selectIngestStrategy(hasMuData: boolean, isMultiDataset: boolean): IngestStrategy {
  if (hasMuData) return "mudata";
  return isMultiDataset ? "streaming" : "chunked";
}

/**
 * Remote stores have no cheap staleness fingerprint, and MuData ingests go
 * through a handle that the cached-db path cannot reconstruct.
 */
export function shouldUseIngestCache(allLocal: boolean, hasMuData: boolean): boolean {
  return allLocal && !hasMuData;
}

function createMuDataInitializers(prepared: PreparedDatasets): Initializers {
  const handle = prepared.loaded[0].adata as MuData;
  return {
    initStore: (connection) => handle.toDuckDB(connection, { skipVar: true }),
    initVar: (connection) => handle.toDuckDB(connection, { skipObs: true }),
  };
}

async function createChunkedInitializers(prepared: PreparedDatasets): Promise<Initializers> {
  const dataset = prepared.loaded[0];
  let rawStore: Awaited<ReturnType<typeof openBunStore>>["store"];
  try {
    ({ store: rawStore } = await openBunStore(dataset.entry.path));
  } catch (error) {
    throw new Error(`${dataset.entry.name}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }

  return {
    initStore: async (connection) => {
      await ingestDataFrameChunked(connection, "obs_base", rawStore, "obs", {
        axis: "obs",
        includeNameColumn: true,
      });
    },
    initVar: async (connection) => {
      await ingestDataFrameChunked(connection, "var_base", rawStore, "var", {
        axis: "var",
        includeNameColumn: true,
      });
    },
  };
}

function createStreamingInitializers(prepared: PreparedDatasets): Initializers {
  return {
    initStore: async (connection) => {
      await ingestDataFramesStreaming(
        connection,
        "obs_base",
        prepared.loaded.map(({ adata }) => adata.obs),
        { datasetNames: prepared.datasetNames, axis: "obs", includeNameColumn: true },
      );
    },
    initVar: async (connection) => {
      await ingestDataFramesStreaming(
        connection,
        "var_base",
        prepared.loaded.map(({ adata }) => adata.var),
        { datasetNames: prepared.datasetNames, axis: "var", includeNameColumn: true },
      );
    },
  };
}

async function createInitializers(prepared: PreparedDatasets, strategy: IngestStrategy): Promise<Initializers> {
  if (strategy === "mudata") return createMuDataInitializers(prepared);
  if (strategy === "chunked") return createChunkedInitializers(prepared);
  return createStreamingInitializers(prepared);
}

async function openCachedSession(
  prepared: PreparedDatasets,
  strategy: IngestStrategy,
  initializers: Initializers,
  onCached: (key: string) => void,
): Promise<DatasetQuerySession> {
  const key = ingestCacheKey(
    VERSION,
    prepared.loaded.map(({ entry }) => ({ name: entry.name, path: entry.path })),
    strategy,
    prepared.hidden,
  );
  const { cacheDir, dbPath } = resolveIngestCachePath(key);
  const pragmas = ingestPragmas();

  if (existsSync(dbPath)) {
    try {
      const cached = await DatasetQuerySession.fromCachedDb(dbPath, {
        hidden: prepared.hidden,
        pragmas,
        expectKey: key,
      });
      onCached(key);
      return cached;
    } catch {
      // A stale, partial, or unreadable cache is rebuilt below.
    }
  }

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}.wal`, { force: true });
  mkdirSync(cacheDir, { recursive: true });
  const store = await DatasetQuerySession.fromInit(initializers.initStore, {
    hidden: prepared.hidden,
    initVar: initializers.initVar,
    dbPath,
    pragmas,
  });
  await store.writeIngestMeta(key);
  return store;
}

export function createQuerySession(prepared: PreparedDatasets): Promise<PreparedQuerySession> {
  return task("Loading observations into DuckDB", async (update) => {
    const strategy = selectIngestStrategy(prepared.hasMuData, prepared.isMultiDataset);
    const initializers = await createInitializers(prepared, strategy);
    const allLocal = prepared.loaded.every(({ entry }) => isLocalPath(entry.path));
    const cacheEnabled = shouldUseIngestCache(allLocal, prepared.hasMuData);
    let cached = "";
    const store = cacheEnabled
      ? await openCachedSession(prepared, strategy, initializers, (key) => {
          cached = `  ${label(`↻ cached ingest ${key}`)}`;
        })
      : await DatasetQuerySession.fromInit(initializers.initStore, {
          hidden: prepared.hidden,
          initVar: initializers.initVar,
        });

    const vars = store.hasVarTable ? `, ${num(store.nVars)} variables` : "";
    update(`${num(store.nObs)} observations${vars} in DuckDB${cached}`);
    return { store, cacheEnabled, cached: cached !== "" };
  });
}
