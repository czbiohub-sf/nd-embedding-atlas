/**
 * /api/scatter-positions — Phase 0 regression: positions are served from
 * the ObsmSliceLoader, NOT from a DuckDB-registered embedding table.
 *
 * Uses the `annotations.zarr` fixture if present; skipped otherwise.
 */

import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { openAnnData } from "../../zarr/index.ts";
import { createApp } from "../app.ts";
import { EmbeddingStore } from "../store.ts";
import type { DatasetMeta, ViewerState } from "../state.ts";

const FIXTURE = path.resolve(import.meta.dir, "../../../../ome-atlas-test-data/annotations.zarr");
const HAS_FIXTURE = existsSync(FIXTURE);

type Server = ReturnType<typeof createApp>;

async function buildState(): Promise<{ state: ViewerState; server: Server; port: number }> {
  const adata = await openAnnData(FIXTURE);
  const nObs = adata.nObs;

  // Minimal obs_base: row index + obs_name only. The positions route
  // doesn't read from obs_base in Phase 0 — it goes straight to the loader.
  const store = await EmbeddingStore.fromInit(async (conn) => {
    const rows: string[] = [];
    for (let i = 0; i < nObs; i++) rows.push(`(${i}, 'obs_${i}')`);
    // Batch the VALUES clause to avoid overlong SQL on large fixtures.
    await conn.run("CREATE TABLE obs_base (__row_index__ INTEGER, obs_name VARCHAR)");
    const BATCH = 500;
    for (let s = 0; s < rows.length; s += BATCH) {
      await conn.run(`INSERT INTO obs_base VALUES ${rows.slice(s, s + BATCH).join(", ")}`);
    }
  });

  const state: ViewerState = {
    store,
    datasets: new Map([["fixture", { path: FIXTURE }]]),
    spatial: { fov: null, t: null, bbox: null, x: null, y: null, z: null },
    obsColumns: ["obs_name"],
    port: 0,
    availableObsmKeys: ["X_pca"],
    loadingTasks: new Map(),
    loadErrors: new Map(),
    accessors: new Map([["fixture", adata]]),
    plateMounts: [],
    obsmLoaders: new Map(),
    cropPool: null,
  };

  const meta: DatasetMeta = {
    obsColumnNames: ["obs_name"],
    embeddingProps: {},
    hasPlate: false,
    plateMeta: null,
    defaultX: "pca_0",
    defaultY: "pca_1",
    idColumn: "__row_index__",
    datasetKeys: ["fixture"],
    datasetChannels: null,
  };

  const server = createApp({ port: 0, host: "127.0.0.1", store, state, config: meta, noStatic: true });
  const port = server.port ?? 0;
  return { state, server, port };
}

describe("scatter-positions — Phase 0 bypass", () => {
  let pending: Server | null = null;

  afterEach(() => {
    pending?.stop(true);
    pending = null;
  });

  test("serves positions via SliceLoader without registering embedding in DuckDB", async () => {
    if (!HAS_FIXTURE) return;
    const { state, server, port } = await buildState();
    pending = server;

    const res = await fetch(`http://localhost:${port}/api/scatter-positions?embedding=X_pca&x_col=pca_0&y_col=pca_1`);
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());

    // Binary frame v1: 1B version + 4B header_len + header + padding + data.
    expect(buf[0]).toBe(1);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const headerLen = view.getUint32(1, true);
    const headerJson = new TextDecoder().decode(buf.subarray(5, 5 + headerLen));
    const header = JSON.parse(headerJson) as {
      numCells: number;
      embeddingKey: string;
      ndim: number;
      positionScale: number;
    };
    expect(header.embeddingKey).toBe("X_pca");
    expect(header.ndim).toBe(2);
    expect(header.numCells).toBe(state.accessors.get("fixture")!.nObs);

    // KEY REGRESSION: no DuckDB table was created for this embedding.
    expect(state.store.loadedEmbeddings.has("X_pca")).toBe(false);
    // Loader was registered instead.
    expect(state.obsmLoaders.has("X_pca")).toBe(true);
    expect(state.obsmLoaders.get("X_pca")!.width).toBeGreaterThan(1);
  });

  test("rejects unknown embedding with 404", async () => {
    if (!HAS_FIXTURE) return;
    const { server, port } = await buildState();
    pending = server;

    const res = await fetch(
      `http://localhost:${port}/api/scatter-positions?embedding=X_bogus&x_col=bogus_0&y_col=bogus_1`,
    );
    expect(res.status).toBe(404);
  });

  test("rejects missing dim suffix with 400", async () => {
    if (!HAS_FIXTURE) return;
    const { server, port } = await buildState();
    pending = server;

    const res = await fetch(`http://localhost:${port}/api/scatter-positions?embedding=X_pca&x_col=pca&y_col=pca_1`);
    expect(res.status).toBe(400);
  });

  test("aborted request does not populate loader cache", async () => {
    if (!HAS_FIXTURE) return;
    const { state, server, port } = await buildState();
    pending = server;

    const ctrl = new AbortController();
    // Abort immediately before the server writes back.
    queueMicrotask(() => ctrl.abort());

    let caught: unknown = null;
    try {
      await fetch(`http://localhost:${port}/api/scatter-positions?embedding=X_pca&x_col=pca_0&y_col=pca_1`, {
        signal: ctrl.signal,
      });
    } catch (e) {
      caught = e;
    }
    // Either the fetch threw (AbortError) or returned 499; both are
    // valid "aborted" outcomes. What matters is cache hygiene below.
    void caught;

    // Loader may have been registered (state.obsmLoaders.set happens
    // before the await chain); but the column for dim 0 or 1 should
    // not be stuck in the inflight map after the abort settles.
    // Verify by doing a fresh fetch and confirming it returns 200.
    const recovery = await fetch(
      `http://localhost:${port}/api/scatter-positions?embedding=X_pca&x_col=pca_0&y_col=pca_1`,
    );
    expect(recovery.status).toBe(200);
    void state;
  });
});
