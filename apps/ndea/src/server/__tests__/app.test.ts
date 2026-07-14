/**
 * Smoke tests for the Bun.serve HTTP server.
 *
 * Starts the server on a random port, verifies core endpoints,
 * then shuts it down.
 */

import { describe, expect, test, afterEach } from "bun:test";
import type { DuckDBConnection } from "@duckdb/node-api";
import { join } from "node:path";
import {
  ConfigResponseSchema,
  EmbeddingStatusSchema,
  MetadataSchema,
  PluginBootstrapCatalogSchema,
  VarColumnResponseSchema,
} from "@ndea/protocol";
import { DatasetQuerySession } from "../store.ts";
import { createApp, type CreateAppOptions } from "../app.ts";
import type { ServerSession, DatasetSessionMetadata } from "../state.ts";
import type { ServerSocketContext } from "../ws.ts";
import { buildPluginBootstrap } from "../plugins/bootstrap.ts";

type NdeaServer = ReturnType<typeof createApp>;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a mock analytical dataset query session with test data. */
function createMockStore(n = 100): Promise<DatasetQuerySession> {
  return DatasetQuerySession.fromInit(async (conn: DuckDBConnection) => {
    const rows: string[] = [];
    for (let i = 0; i < n; i++) {
      const cat = i % 3 === 0 ? "A" : i % 3 === 1 ? "B" : "C";
      const val = (Math.random() * 100).toFixed(2);
      rows.push(`(${i}, 'obs_${i}', 'test_dataset', '${cat}', ${val}::FLOAT)`);
    }
    await conn.run(
      `CREATE TABLE obs_base AS SELECT * FROM (VALUES ${rows.join(", ")}) AS t(__row_index__, obs_name, _dataset, category, value)`,
    );
  });
}

/** Create a minimal server session for testing. */
function createMockState(store: DatasetQuerySession): ServerSession {
  return {
    store,
    datasets: new Map([["test_dataset", { path: "/tmp/test.zarr" }]]),
    spatial: { fov: null, t: null, bbox: null, x: null, y: null, z: null },
    obsColumns: ["obs_name", "_dataset", "category", "value"],
    port: 0,
    availableObsmKeys: ["X_umap", "X_tsne"],
    loadingTasks: new Map(),
    loadErrors: new Map(),
    accessors: new Map(),
    plateMounts: [],
    obsmLoaders: new Map(),
    cropPool: null,
    annotationsSidecarPath: null,
  };
}

/** Create minimal dataset session metadata for testing. */
function createMockConfig(): DatasetSessionMetadata {
  return {
    obsColumnNames: ["obs_name", "_dataset", "category", "value"],
    embeddingProps: {
      data: {
        id: "__row_index__",
        projection: { x: "umap_0", y: "umap_1" },
      },
    },
    hasPlate: false,
    plateMeta: null,
    defaultX: "umap_0",
    defaultY: "umap_1",
    idColumn: "__row_index__",
    datasetKeys: ["test_dataset"],
    datasetChannels: null,
  };
}

/**
 * Send one request over the Mosaic WS connector and return the decoded reply.
 * socketConnector framing: send JSON text, receive either ArrayBuffer (arrow)
 * or JSON text (exec / json / error).
 */
function mosaicWsRequest<T>(
  port: number | undefined,
  query: { type: "arrow" | "json" | "exec"; sql: string },
): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/mosaic`);
    ws.binaryType = "arraybuffer";
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("ws timeout"));
    }, 5000);
    ws.addEventListener("open", () => ws.send(JSON.stringify(query)));
    ws.addEventListener("message", (ev) => {
      clearTimeout(timer);
      ws.close();
      if (typeof ev.data === "string") {
        try {
          resolve(JSON.parse(ev.data) as T);
        } catch (err) {
          reject(err);
        }
      } else {
        resolve(ev.data as T);
      }
    });
    ws.addEventListener("error", (err) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error("ws error"));
    });
  });
}

/** Send one framed request over the ndea WebSocket and return its first reply. */
function ndeaWsRequest<T>(port: number | undefined, frame: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("ws timeout"));
    }, 5000);
    ws.addEventListener("open", () => ws.send(JSON.stringify(frame)));
    ws.addEventListener("message", (ev) => {
      clearTimeout(timer);
      ws.close();
      try {
        resolve(JSON.parse(String(ev.data)) as T);
      } catch (err) {
        reject(err);
      }
    });
    ws.addEventListener("error", (err) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error("ws error"));
    });
  });
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

let activeServer: NdeaServer | null = null;
let activeStore: DatasetQuerySession | null = null;

afterEach(() => {
  if (activeServer) {
    activeServer.stop(true);
    activeServer = null;
  }
  if (activeStore) {
    activeStore.close();
    activeStore = null;
  }
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("createApp", () => {
  test("starts server and responds to /data/metadata.json", async () => {
    const store = await createMockStore(50);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const options = {
      port: 0, // random port
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    } satisfies CreateAppOptions;
    const socketContext = { kind: "ndea", state, store } satisfies ServerSocketContext;
    expect(socketContext.state).toBe(state);
    expect(socketContext.store).toBe(store);

    const server = createApp(options);
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/data/metadata.json`);
    expect(res.status).toBe(200);

    const body = MetadataSchema.parse(await res.json());
    expect(body).toHaveProperty("obsm");
    expect(body).toHaveProperty("obs_columns");
    expect(body.obs_columns).toContain("category");
    expect(body.database).toEqual({ type: "rest" });
    // No --preset / preset: set on the mock config → the annotate default (R2/R3).
    expect(body.preset).toBe("annotate");
  });

  test("Mosaic JSON query works", async () => {
    const store = await createMockStore(10);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/data/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "json",
        sql: "SELECT DISTINCT _dataset FROM dataset",
      }),
    });
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0]._dataset).toBe("test_dataset");
  });

  test("Mosaic Arrow query returns binary data", async () => {
    const store = await createMockStore(10);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/data/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "arrow",
        sql: "SELECT __row_index__, category FROM dataset LIMIT 5",
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.apache.arrow.stream");

    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  test("Mosaic WS /mosaic handles JSON query", async () => {
    const store = await createMockStore(10);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({ port: 0, host: "localhost", store, state, config, noStatic: true });
    activeServer = server;

    const rows = await mosaicWsRequest<{ _dataset: string }[]>(server.port, {
      type: "json",
      sql: "SELECT DISTINCT _dataset FROM dataset",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?._dataset).toBe("test_dataset");
  });

  test("Mosaic WS /mosaic returns binary Arrow IPC", async () => {
    const store = await createMockStore(10);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({ port: 0, host: "localhost", store, state, config, noStatic: true });
    activeServer = server;

    const buf = await mosaicWsRequest<ArrayBuffer>(server.port, {
      type: "arrow",
      sql: "SELECT __row_index__, category FROM dataset LIMIT 5",
    });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  test("Mosaic WS /mosaic blocks disallowed statements", async () => {
    const store = await createMockStore(10);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({ port: 0, host: "localhost", store, state, config, noStatic: true });
    activeServer = server;

    const resp = await mosaicWsRequest<{ error: string }>(server.port, {
      type: "exec",
      sql: "DROP TABLE obs_base",
    });
    expect(resp.error).toBe("Statement type not allowed");
  });

  test("GET /api/health returns status ok", async () => {
    const store = await createMockStore(25);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/api/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.n_obs).toBe(25);
  });

  test("GET /api/config returns viewer config", async () => {
    const store = await createMockStore(10);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/api/config`);
    expect(res.status).toBe(200);

    const body = ConfigResponseSchema.parse(await res.json());
    expect(body.availableObsmKeys).toEqual(["X_umap", "X_tsne"]);
    expect(body.nObs).toBe(10);
  });

  test("GET /api/embeddings/{key}/status returns not_started", async () => {
    const store = await createMockStore(10);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/api/embeddings/X_umap/status`);
    expect(res.status).toBe(200);

    const rawBody = await res.json();
    expect(rawBody).toEqual({ status: "not_started" });
    expect(EmbeddingStatusSchema.parse(rawBody)).toEqual(rawBody);
  });

  test("POST /api/embeddings/{key} triggers loading", async () => {
    const store = await createMockStore(10);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/api/embeddings/X_umap`, {
      method: "POST",
    });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.status).toBe("loading");
  });

  test("CORS headers are set on responses", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/api/health`);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  test("OPTIONS returns 204 preflight", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/api/health`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("unknown API route returns 404", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/api/nonexistent`);
    expect(res.status).toBe(404);
  });

  test("noStatic returns 404 for root path", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/`);
    expect(res.status).toBe(404);
  });

  test("GET /api/var/layers returns default layers", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/api/var/layers`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.layers).toEqual(["X"]);
  });

  test("var-column WebSocket preserves the optional modality", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const raw = await ndeaWsRequest<Record<string, unknown>>(server.port, {
      _id: 1,
      _type: "var-column/load",
      name: "CD3D",
      modality: "rna",
    });
    expect(raw).toMatchObject({
      _id: 1,
      _ch: "end",
      status: "loading",
      column: "__var_rna_CD3D_X__",
    });
    const parsed = VarColumnResponseSchema.parse(raw);
    expect(parsed.task_id).toBeString();
    expect(parsed.status).toBe("loading");
    expect(parsed.column).toBe("__var_rna_CD3D_X__");
  });

  test("blocked SQL returns 400 via Mosaic endpoint", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();

    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    });
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/data/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "exec",
        sql: "DROP TABLE obs_base",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not allowed");
  });

  test("serves the startup plugin snapshot without disturbing existing app routes", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    const state = createMockState(store);
    const config = createMockConfig();
    const pluginSnapshot = await buildPluginBootstrap({
      projectPluginPaths: [join(import.meta.dir, "../plugins/__fixtures__/valid-plugin")],
      userConfig: { schemaVersion: 1, entries: [] },
    });
    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
      pluginSnapshot,
    });
    activeServer = server;

    const bootstrapResponse = await fetch(`http://localhost:${server.port}/api/plugins/bootstrap`);
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = PluginBootstrapCatalogSchema.parse(await bootstrapResponse.json());
    expect(String(bootstrap.entries[0]?.manifest.pluginId)).toBe("fixture.valid");
    expect(JSON.stringify(bootstrap)).not.toContain(join(import.meta.dir, "../plugins"));

    const clientResponse = await fetch(`http://localhost:${server.port}${bootstrap.entries[0]?.clientEntryUrl}`);
    expect(clientResponse.status).toBe(200);
    expect(clientResponse.headers.get("cache-control")).toContain("immutable");
    expect(await clientResponse.text()).toContain("register");

    const undeclared = await fetch(
      `http://localhost:${server.port}${bootstrap.entries[0]?.clientEntryUrl.replace("client.js", "undeclared.js")}`,
    );
    expect(undeclared.status).toBe(404);

    const health = await fetch(`http://localhost:${server.port}/api/health`);
    expect(health.status).toBe(200);
  });
});
