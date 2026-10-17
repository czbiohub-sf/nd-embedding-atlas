#!/usr/bin/env bun
/**
 * `vp run dev [--fixture]`: one Bun process serves the API, /data/query, /ws,
 * /mcp, and the frontend source through Bun's dev server (HMR, browser console
 * echoed here) on PORT. portless assigns PORT and proxies
 * https://ndea.localhost (https://<branch>.ndea.localhost in a linked
 * worktree). Run from the repo root so bunfig.toml's `[serve.static]` plugins
 * (scripts/frontend-plugin.ts) apply.
 *
 *   vp run dev             ../ome-atlas-test-data/infectomics/infectomics.yaml beside the repo
 *   vp run dev --fixture   synthetic in-memory dataset, no Zarr store needed
 */

import type { DuckDBConnection } from "@duckdb/node-api";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { app } from "../src/cli/index.ts";
import { registerGracefulShutdown } from "../src/cli/startup/server.ts";
import { createApp } from "../src/server/app.ts";
import { loadMcpToken } from "../src/server/mcp-token.ts";
import type { ObsmSliceLoader } from "../src/server/slice-loader.ts";
import { createServerSession } from "../src/server/state.ts";
import { DatasetQuerySession } from "../src/server/store.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

if (Bun.argv.includes("--fixture")) {
  await serveFixture();
} else {
  const dataset = resolve(REPO_ROOT, "../ome-atlas-test-data/infectomics/infectomics.yaml");
  if (!existsSync(dataset)) {
    console.error(
      `[dev] default dataset not found: ${dataset}\n` +
        "      clone ome-atlas-test-data beside this repo, or run `vp run dev --fixture`",
    );
    process.exit(1);
  }
  await app.execute({ argv: ["view", dataset, "--dev", "--no-open"] });
}

/**
 * A synthetic in-memory dataset behind the real server, so the Mosaic query
 * route, the `dataset` view, and the REST routes are all genuine without a
 * Zarr store on disk (the mock-store pattern of `server/__tests__/store.test.ts`).
 */
async function serveFixture(): Promise<void> {
  const port = Number(process.env.PORT ?? 5055);
  const rows = 2000;
  const embeddingKey = "X_fixture";
  const obsColumns = ["__row_index__", "obs_name", "_dataset", "category", "value", "score", "umap_0", "umap_1"];

  const store = await DatasetQuerySession.fromInit(async (conn: DuckDBConnection) => {
    // `value` is multi-modal so a histogram shows structure; `category` is
    // skewed so a count plot is not four identical bars.
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
      FROM range(0, ${rows}) t(i)
    `);
  });

  const embeddingColumns = [
    Float32Array.from({ length: rows }, (_, i) => Math.cos(i / 30) * 10),
    Float32Array.from({ length: rows }, (_, i) => Math.sin(i / 30) * 10),
  ];
  const embeddingLoader = {
    width: embeddingColumns.length,
    loadColumn(dimension: number) {
      const column = embeddingColumns[dimension];
      if (!column) throw new Error(`Unknown fixture embedding dimension: ${dimension}`);
      return Promise.resolve(column);
    },
  } as unknown as ObsmSliceLoader;

  const state = createServerSession({
    store,
    availableObsmKeys: [embeddingKey],
    obsmLoaders: new Map([[embeddingKey, embeddingLoader]]),
  });
  const server = createApp({
    port,
    host: "127.0.0.1",
    store,
    state,
    config: {
      obsColumnNames: obsColumns,
      embeddingProps: {},
      hasPlate: false,
      plateMeta: null,
      defaultX: "umap_0",
      defaultY: "umap_1",
      idColumn: "obs_name",
      datasetKeys: null,
      datasetChannels: null,
    },
    dev: true,
    mcpToken: await loadMcpToken(),
  });

  console.log(`[dev] fixture: ${rows} synthetic rows on ${server.url}`);
  console.log("[dev] numeric: value, score, umap_0, umap_1 | categorical: category, _dataset, obs_name");
  void registerGracefulShutdown({ host: "127.0.0.1", port }, state, server);
}
