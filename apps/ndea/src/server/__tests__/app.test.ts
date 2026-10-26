/**
 * Smoke tests for the Bun.serve HTTP server.
 *
 * Starts the server on a random port, verifies core endpoints,
 * then shuts it down.
 */

import { describe, expect, test, afterEach } from "bun:test";
import type { DuckDBConnection } from "@duckdb/node-api";
import { decodeIPC, restConnector } from "@uwdata/mosaic-core";
import { EmbeddingStatusSchema, MetadataSchema, RuntimeStatusSchema } from "@ndea/protocol";
import { DatasetQuerySession } from "../store.ts";
import { appServeOptions, createApp, type CreateAppOptions } from "../app.ts";
import { SessionHost, type HostedSession } from "../session-host.ts";
import type { ServerSession, DatasetSessionMetadata } from "../state.ts";
import { createServerSession } from "../state.ts";
import { captureConsole } from "../status.ts";
import type { ServerSocketContext } from "../ws.ts";

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
  return createServerSession({
    store,
    datasets: new Map([["test_dataset", { path: "/tmp/test.zarr" }]]),
    availableObsmKeys: ["X_umap", "X_tsne"],
  });
}

/** Create minimal dataset session metadata for testing. */
function createMockConfig(): DatasetSessionMetadata {
  return {
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

// ─── Lifecycle ──────────────────────────────────────────────────────────────

let activeServer: NdeaServer | null = null;
let activeStore: DatasetQuerySession | null = null;

async function startTestServer(n = 5): Promise<NdeaServer> {
  const store = await createMockStore(n);
  activeStore = store;
  const server = createApp({
    port: 0,
    host: "localhost",
    store,
    state: createMockState(store),
    config: createMockConfig(),
    noStatic: true,
  });
  activeServer = server;
  return server;
}

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
    state.spatial = { fov: "fov_name", t: "t", bbox: null, x: "x", y: "y", z: "z_slice" };
    const config = createMockConfig();

    const options = {
      port: 0, // random port
      host: "localhost",
      store,
      state,
      config,
      noStatic: true,
    } satisfies CreateAppOptions;
    const socketContext = { state } satisfies ServerSocketContext;
    expect(socketContext.state).toBe(state);

    const server = createApp(options);
    activeServer = server;

    const res = await fetch(`http://localhost:${server.port}/data/metadata.json`);
    expect(res.status).toBe(200);

    const body = MetadataSchema.parse(await res.json());
    expect(body).toHaveProperty("obsm");
    expect(body.database).toEqual({ type: "rest" });
    expect(body.spatial?.crop_fov_col).toBe("fov_name");
    expect(body.spatial?.z_col).toBe("z_slice");
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

  test("Mosaic restConnector round-trips arrow, exec, and errors via /data/query", async () => {
    const server = await startTestServer(10);
    const db = restConnector({ uri: `http://localhost:${server.port}/data/query` });

    const bytes = await db.query({ type: "arrow", sql: "SELECT DISTINCT _dataset FROM dataset" });
    expect(decodeIPC(bytes).toArray()).toEqual([{ _dataset: "test_dataset" }]);
    expect(await db.query({ type: "exec", sql: "CREATE SCHEMA IF NOT EXISTS mosaic" })).toBeUndefined();
    await expect(db.query({ type: "exec", sql: "DROP TABLE obs_base" })).rejects.toThrow("Statement type not allowed");
    await expect(db.query({ type: "arrow", sql: "SELECT * FROM missing_table" })).rejects.toThrow("HTTP status 500");
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

  test("GET /api/status needs the bearer token, counts browser sockets, and reports datasets and logs", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    const state = createMockState(store);
    const dataset = {
      name: "test",
      format: "anndata" as const,
      path: "/data/t.zarr",
      observations: 5,
      variables: 2,
      obsColumns: 3,
      embeddings: ["X_umap"],
      plate: { path: "/data/p.zarr", wells: 1, channels: [{ name: "DAPI", color: "#0000FF" }] },
    };
    const collections = [{ name: "t", datasets: [{ name: "t", nObs: 5 }] }];
    state.status = { ingest: "fresh", datasets: [dataset], collection: "t", collections };
    captureConsole();
    console.warn("\u001B[33mstatus warning\u001B[39m");
    const server = createApp({
      port: 0,
      host: "localhost",
      store,
      state,
      config: createMockConfig(),
      noStatic: true,
      mcpToken: "secret",
    });
    activeServer = server;
    const url = `http://localhost:${server.port}/api/status`;
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);

    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const opened = Promise.withResolvers<void>();
    ws.addEventListener("open", () => opened.resolve());
    await opened.promise;
    const res = await fetch(url, { headers: { authorization: "Bearer secret" } });
    expect(res.status).toBe(200);
    const status = RuntimeStatusSchema.parse(await res.json());
    expect(status.clients.browserSockets).toBe(1);
    expect(status.workspace.revision).toBeGreaterThanOrEqual(0);
    expect(status.server.ingest).toBe("fresh");
    expect(status.datasets).toEqual([dataset]);
    expect(status).toMatchObject({ collection: "t", collections });
    expect(status.logs.at(-1)).toMatchObject({ level: "warn", text: "status warning" });
    ws.close();
  });

  test("POST /api/collection switches through the SessionHost: filters cleared, routes reloaded, tabs told", async () => {
    const collections = [
      { name: "a", datasets: [{ name: "x", nObs: 1 }] },
      { name: "b", datasets: [{ name: "y", nObs: 2 }] },
    ];
    const store = await createMockStore(5);
    activeStore = store;
    const state = createMockState(store);
    state.status = { ...state.status, collection: "a", collections };
    const filter = { op: "in", column: "_dataset", values: ["test_dataset"] };
    await state.workspace.patch(
      [{ op: "add", path: "/state/filter", value: { A: { dataset: { _dataset: filter } } } }],
      {
        base: 0,
        actor: { kind: "browser" },
      },
    );
    const opened: string[] = [];
    const sessions = new SessionHost({ state, metadata: createMockConfig() }, async (name) => {
      opened.push(name);
      const next = createServerSession({ store: await createMockStore(7), workspace: state.workspace });
      next.status = { ...next.status, collection: name, collections };
      return { state: next, metadata: createMockConfig() };
    });
    const options = ({ state: session, metadata }: HostedSession): CreateAppOptions => ({
      port: 0,
      host: "localhost",
      store: session.store,
      state: session,
      config: metadata,
      noStatic: true,
      sessions,
    });
    const server = createApp(options(sessions.current));
    activeServer = server;
    sessions.onChange((next) => server.reload<string>(appServeOptions(options(next))));
    const base = `http://localhost:${server.port}`;

    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const pushed: string[] = [];
    let arrived = Promise.withResolvers<void>();
    ws.addEventListener("message", (event) => {
      pushed.push(JSON.parse(String(event.data)).collection);
      arrived.resolve();
    });
    const open = Promise.withResolvers<unknown>();
    ws.addEventListener("open", open.resolve, { once: true });
    await open.promise;
    ws.send(JSON.stringify({ _id: 1, _type: "session/watch" }));
    await arrived.promise;
    arrived = Promise.withResolvers<void>();

    const post = (body: unknown) =>
      fetch(`${base}/api/collection`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.status);
    expect(await post({})).toBe(400);
    expect(await post({ name: "nope" })).toBe(404);
    expect(await post({ name: "a" })).toBe(200);
    expect(opened).toEqual([]);
    expect(await post({ name: "b" })).toBe(200);
    expect(opened).toEqual(["b"]);
    activeStore = sessions.current.state.store; // the host closed the old one
    expect(state.workspace.get()).toMatchObject({ revision: 2, document: { state: { filter: { A: {} } } } });
    expect(state.workspace.history({ limit: 1 })[0].actor).toEqual({ kind: "system" });
    const metadata = MetadataSchema.parse(await (await fetch(`${base}/data/metadata.json`)).json());
    expect(metadata).toMatchObject({ collection: "b", collections });
    await arrived.promise;
    expect(pushed).toEqual(["a", "b"]);
    ws.close();
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

  test("ordered API families preserve specific route precedence", async () => {
    const server = await startTestServer();
    const baseUrl = `http://localhost:${server.port}`;

    const batch = await fetch(`${baseUrl}/api/obs/batch`, { method: "POST" });
    expect(batch.status).toBe(200);
    expect(await batch.json()).toEqual({});

    const detail = await fetch(`${baseUrl}/api/obs/2/detail`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      __row_index__: "2",
      obs_name: "obs_2",
      category: "C",
    });

    const embeddingStatus = await fetch(`${baseUrl}/api/embeddings/X_umap/status`);
    expect(embeddingStatus.status).toBe(200);
    expect(await embeddingStatus.json()).toEqual({ status: "not_started" });

    const annotationColumns = await fetch(`${baseUrl}/api/annotations/columns`);
    expect(annotationColumns.status).toBe(200);
    expect(await annotationColumns.json()).toEqual({ columns: [] });

    const exportStatus = await fetch(`${baseUrl}/api/export/missing/status`);
    expect(exportStatus.status).toBe(404);
    expect(await exportStatus.json()).toEqual({ error: "Export task not found" });
  });

  test("unsupported API methods return 405 with Allow", async () => {
    const server = await startTestServer();
    const baseUrl = `http://localhost:${server.port}`;
    const requests = [
      ["POST", "/api/health", "GET"],
      ["GET", "/api/obs/batch", "POST"],
      ["POST", "/api/obs/2/detail", "GET"],
      ["GET", "/api/embeddings/X_umap", "POST"],
      ["PUT", "/api/annotations/columns", "GET, POST"],
      ["POST", "/api/export/missing/status", "GET"],
    ] as const;

    for (const [method, pathname, allow] of requests) {
      const response = await fetch(`${baseUrl}${pathname}`, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe(allow);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(await response.json()).toEqual({
        error: `Method not allowed: ${method} ${pathname}`,
      });
    }
  });

  test("unknown API route returns 404", async () => {
    const server = await startTestServer();

    const res = await fetch(`http://localhost:${server.port}/api/nonexistent`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Unknown API endpoint: GET /api/nonexistent",
    });
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
});
