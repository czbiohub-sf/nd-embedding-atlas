import { existsSync, mkdirSync, rmSync } from "node:fs";
import { ingestCacheKey, ingestPragmas, isLocalPath, resolveIngestCachePath } from "../../server/ingest-cache.ts";
import { DatasetQuerySession } from "../../server/store.ts";
import { ingestObs, ingestVar, type IngestDataset } from "../../server/zarr-ingest.ts";
import { label, num, task } from "../lib/style.ts";
import { VERSION } from "../version.ts";
import type { PreparedDatasets } from "./datasets.ts";

export interface PreparedQuerySession {
  store: DatasetQuerySession;
  cacheEnabled: boolean;
  /** The DuckDB file came from the ingest cache instead of a fresh ingest. */
  cached: boolean;
}

async function openCachedSession(
  prepared: PreparedDatasets,
  datasets: readonly IngestDataset[],
  onCached: (key: string) => void,
): Promise<DatasetQuerySession> {
  const key = ingestCacheKey(
    VERSION,
    prepared.loaded.map(({ entry }) => ({ name: entry.name, path: entry.path })),
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
  const store = await DatasetQuerySession.fromInit((connection) => ingestObs(connection, datasets), {
    hidden: prepared.hidden,
    initVar: (connection) => ingestVar(connection, datasets),
    dbPath,
    pragmas,
  });
  await store.writeIngestMeta(key);
  return store;
}

export function createQuerySession(prepared: PreparedDatasets): Promise<PreparedQuerySession> {
  return task("Loading observations into DuckDB", async (update) => {
    const datasets = prepared.loaded.map(({ entry, adata }) => ({ name: entry.name, handle: adata }));
    // Remote stores have no cheap staleness fingerprint, so only local projects are cached.
    const cacheEnabled = prepared.loaded.every(({ entry }) => isLocalPath(entry.path));
    let cached = "";
    const store = cacheEnabled
      ? await openCachedSession(prepared, datasets, (key) => {
          cached = `  ${label(`↻ cached ingest ${key}`)}`;
        })
      : await DatasetQuerySession.fromInit((connection) => ingestObs(connection, datasets), {
          hidden: prepared.hidden,
          initVar: (connection) => ingestVar(connection, datasets),
        });

    const vars = store.hasVarTable ? `, ${num(store.nVars)} variables` : "";
    update(`${num(store.nObs)} observations${vars} in DuckDB${cached}`);
    return { store, cacheEnabled, cached: cached !== "" };
  });
}
