/**
 * Smoke tests for the Bun.serve HTTP server.
 *
 * Starts the server on a random port, verifies core endpoints,
 * then shuts it down.
 */

import { describe, expect, test, afterEach } from "vitest";
import type { Server } from "bun";
import type { DuckDBConnection } from "@duckdb/node-api";
import { EmbeddingStore } from "../store.ts";
import { createApp } from "../app.ts";
import type { ViewerState, DatasetMeta } from "../state.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a mock EmbeddingStore with test data. */
async function createMockStore(n = 100): Promise<EmbeddingStore> {
    return EmbeddingStore.fromInit(async (conn: DuckDBConnection) => {
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

/** Create a minimal ViewerState for testing. */
function createMockState(store: EmbeddingStore): ViewerState {
    return {
        store,
        datasets: new Map([["test_dataset", { path: "/tmp/test.zarr" }]]),
        spatial: { fov: null, t: null, bbox: null, x: null, y: null },
        obsColumns: ["obs_name", "_dataset", "category", "value"],
        port: 0,
        availableObsmKeys: ["X_umap", "X_tsne"],
        loadingTasks: new Map(),
        loadErrors: new Map(),
    };
}

/** Create a minimal DatasetMeta for testing. */
function createMockConfig(): DatasetMeta {
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

// ─── Lifecycle ──────────────────────────────────────────────────────────────

let activeServer: Server | null = null;
let activeStore: EmbeddingStore | null = null;

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

        const server = createApp({
            port: 0, // random port
            host: "localhost",
            store,
            state,
            config,
            noStatic: true,
        });
        activeServer = server;

        const res = await fetch(`http://localhost:${server.port}/data/metadata.json`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body).toHaveProperty("obsm");
        expect(body).toHaveProperty("obs_columns");
        expect(body.obs_columns).toContain("category");
        expect(body.database).toEqual({ type: "rest" });
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

        const body = await res.json();
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

        const res = await fetch(
            `http://localhost:${server.port}/api/embeddings/X_umap/status`,
        );
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.status).toBe("not_started");
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

    test("GET /api/obssets returns empty array initially", async () => {
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

        const res = await fetch(`http://localhost:${server.port}/api/obssets`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body).toEqual([]);
    });

    test("POST /api/obssets creates a new ObsSet", async () => {
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

        const res = await fetch(`http://localhost:${server.port}/api/obssets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Test Set",
                color: "FF0000",
                members: [
                    { dataset_key: "test_dataset", obs_name: "obs_0" },
                    { dataset_key: "test_dataset", obs_name: "obs_1" },
                ],
            }),
        });
        expect(res.status).toBe(201);

        const body = await res.json();
        expect(body.name).toBe("Test Set");
        expect(body.created_count).toBe(2);
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
