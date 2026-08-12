#!/usr/bin/env bun
/**
 * Dev-only fixture backend: serves a synthetic in-memory dataset so the
 * frontend can be exercised without a real Zarr store on disk.
 *
 * `vp run dev <dataset>` requires a Zarr path (`validateZarrPath`), which makes
 * every UI change unverifiable on a machine with no dataset. This mirrors the
 * mock-store pattern already used by `src/server/__tests__/store.test.ts`
 * (`DatasetQuerySession.fromInit` + raw SQL) and drives the real server, so the
 * Mosaic websocket, the `dataset` view, and the REST routes are all genuine.
 *
 * Usage:
 *   vp run --filter @ndea/app dev:fixture # backend, API-only, :5055
 *   vp dev apps/ndea                      # frontend, :5173 (proxies /data, /api, /mosaic)
 */

import type { PlateChannel } from "@ndea/protocol";
import type { DuckDBConnection } from "@duckdb/node-api";
import { createApp } from "../src/server/app.ts";
import { DatasetQuerySession } from "../src/server/store.ts";
import type { DatasetSessionMetadata, ServerSession } from "../src/server/state.ts";
import type { ObsmSliceLoader } from "../src/server/slice-loader.ts";

const PORT = 5055;
const HOST = "127.0.0.1";
const ROWS = 2000;
const EMBEDDING_KEY = "X_fixture";

/** Column names in `obs_base`, in creation order. */
const OBS_COLUMNS = ["__row_index__", "obs_name", "_dataset", "category", "value", "score", "umap_0", "umap_1"];

const store = await DatasetQuerySession.fromInit(async (conn: DuckDBConnection) => {
  // `value` is deliberately multi-modal so a histogram shows real structure
  // rather than a flat block; `category` is skewed so a count plot is not
  // four identical bars.
  await conn.run(`
    CREATE TABLE obs_base AS
    SELECT
      i AS __row_index__,
      'obs_' || i AS obs_name,
      'fixture' AS _dataset,
      CASE WHEN i % 7 = 0 THEN 'alpha'
           WHEN i % 5 = 0 THEN 'beta'
           WHEN i % 3 = 0 THEN 'gamma'
           ELSE 'delta' END AS category,
      (sin(i / 50.0) * 30 + 50)::FLOAT AS value,
      (random() * 100)::DOUBLE AS score,
      (cos(i / 30.0) * 10)::DOUBLE AS umap_0,
      (sin(i / 30.0) * 10)::DOUBLE AS umap_1
    FROM range(0, ${ROWS}) t(i)
  `);
});

const embeddingColumns = [
  Float32Array.from({ length: ROWS }, (_, i) => Math.cos(i / 30) * 10),
  Float32Array.from({ length: ROWS }, (_, i) => Math.sin(i / 30) * 10),
];
const embeddingLoader = {
  width: embeddingColumns.length,
  loadColumn(index: number) {
    const column = embeddingColumns[index];
    if (!column) throw new Error(`Unknown fixture embedding dimension: ${index}`);
    return Promise.resolve(column);
  },
} as unknown as ObsmSliceLoader;

const state: ServerSession = {
  store,
  datasets: new Map(),
  spatial: null,
  obsColumns: OBS_COLUMNS,
  port: PORT,
  availableObsmKeys: [EMBEDDING_KEY],
  loadingTasks: new Map(),
  loadErrors: new Map(),
  accessors: new Map(),
  plateMounts: [],
  obsmLoaders: new Map([[EMBEDDING_KEY, embeddingLoader]]),
  cropPool: null,
  annotationsSidecarPath: null,
};

const config: DatasetSessionMetadata = {
  obsColumnNames: OBS_COLUMNS,
  embeddingProps: {},
  hasPlate: false,
  plateMeta: null,
  defaultX: "umap_0",
  defaultY: "umap_1",
  idColumn: "obs_name",
  datasetKeys: null,
  datasetChannels: null as Record<string, PlateChannel[]> | null,
};

createApp({ port: PORT, host: HOST, store, state, config, noStatic: true });

console.log(`[dev-fixture] ${ROWS} synthetic rows on http://${HOST}:${PORT} (API-only)`);
console.log(`[dev-fixture] numeric: value, score, umap_0, umap_1 | categorical: category, _dataset, obs_name`);
console.log(`[dev-fixture] now run: vp dev apps/ndea`);
