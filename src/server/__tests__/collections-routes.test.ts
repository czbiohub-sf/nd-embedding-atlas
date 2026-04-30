/**
 * Integration tests for /api/collections CRUD endpoints.
 *
 * Run real Bun.serve + DuckDB; fixture obs_base has 50 rows across two
 * datasets so we exercise multi-dataset resolve path. Verifies parameterized
 * SQL handles SQL-injection attempts in strings, optimistic concurrency on
 * PATCH, soft-delete semantics, and refusal on synthetic obs_name.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { DuckDBConnection } from "@duckdb/node-api";
import { createApp } from "../app.ts";
import type { DatasetMeta, ViewerState } from "../state.ts";
import { EmbeddingStore } from "../store.ts";

type NdeaServer = ReturnType<typeof createApp>;

let activeServer: NdeaServer | null = null;
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

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** 50 obs across two datasets (`A`: 30 rows, `B`: 20 rows) with explicit obs_name. */
function makeStore(): Promise<EmbeddingStore> {
  return EmbeddingStore.fromInit(async (conn: DuckDBConnection) => {
    const rows: string[] = [];
    for (let i = 0; i < 30; i++) {
      rows.push(`(${i}, 'cell_${i}', 'A')`);
    }
    for (let i = 30; i < 50; i++) {
      rows.push(`(${i}, 'cell_${i}', 'B')`);
    }
    await conn.run(
      `CREATE TABLE obs_base AS
       SELECT * FROM (VALUES ${rows.join(", ")}) AS t(__row_index__, obs_name, _dataset)`,
    );
  });
}

/** Single-dataset store (no `_dataset` column) — exercises the alternate JOIN path. */
function makeSingleDatasetStore(): Promise<EmbeddingStore> {
  return EmbeddingStore.fromInit(async (conn: DuckDBConnection) => {
    const rows: string[] = [];
    for (let i = 0; i < 25; i++) {
      rows.push(`(${i}, 'cell_${i}')`);
    }
    await conn.run(
      `CREATE TABLE obs_base AS
       SELECT * FROM (VALUES ${rows.join(", ")}) AS t(__row_index__, obs_name)`,
    );
  });
}

/** Synthetic obs_name store — has neither `obs_name` nor `_dataset`; identity is row index. */
function makeSyntheticStore(): Promise<EmbeddingStore> {
  return EmbeddingStore.fromInit(async (conn: DuckDBConnection) => {
    const rows: string[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(`(${i}, ${i % 2 === 0 ? "'A'" : "'B'"})`);
    }
    await conn.run(
      `CREATE TABLE obs_base AS
       SELECT * FROM (VALUES ${rows.join(", ")}) AS t(__row_index__, category)`,
    );
  });
}

function makeState(store: EmbeddingStore): ViewerState {
  return {
    store,
    datasets: new Map([
      ["A", { path: "/tmp/A.zarr" }],
      ["B", { path: "/tmp/B.zarr" }],
    ]),
    spatial: { fov: null, t: null, bbox: null, x: null, y: null },
    obsColumns: ["obs_name", "_dataset"],
    port: 0,
    availableObsmKeys: [],
    loadingTasks: new Map(),
    loadErrors: new Map(),
    accessors: new Map(),
    plateMounts: [],
    obsmLoaders: new Map(),
  };
}

function makeConfig(): DatasetMeta {
  return {
    obsColumnNames: ["obs_name", "_dataset"],
    embeddingProps: { data: { id: "__row_index__", projection: { x: "x", y: "y" } } },
    hasPlate: false,
    plateMeta: null,
    defaultX: "x",
    defaultY: "y",
    idColumn: "__row_index__",
    datasetKeys: ["A", "B"],
    datasetChannels: null,
  };
}

function bootServer(store: EmbeddingStore): NdeaServer {
  const server = createApp({
    port: 0,
    host: "localhost",
    store,
    state: makeState(store),
    config: makeConfig(),
    noStatic: true,
  });
  activeServer = server;
  return server;
}

const DEFAULT_BODY = (overrides: Record<string, unknown> = {}) => ({
  name: "test",
  members: [{ dataset_key: "A", obs_name: "cell_0" }],
  tags: [],
  ...overrides,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("collections routes — list/create", () => {
  test("empty list returns []", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const res = await fetch(`http://localhost:${server.port}/api/collections`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("create collection with members and tags", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const res = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Apoptotic clusters",
        color: "#ff0000",
        notes: "First saved set",
        tags: ["infected", "outlier"],
        members: [
          { dataset_key: "A", obs_name: "cell_0" },
          { dataset_key: "A", obs_name: "cell_1" },
          { dataset_key: "B", obs_name: "cell_30" },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const env = await res.json();
    const c = env.result;
    expect(c.name).toBe("Apoptotic clusters");
    expect(c.color).toBe("#ff0000");
    expect(c.notes).toBe("First saved set");
    expect(c.tags).toEqual(["infected", "outlier"]);
    expect(c.created_count).toBe(3);
    expect(c.current_count).toBe(3);
    expect(c.version).toBe(1);
    expect(c.collection_id).toMatch(/^[0-9a-f-]{36}$/);

    const list = await fetch(`http://localhost:${server.port}/api/collections`).then((r) => r.json());
    expect(list).toHaveLength(1);
    expect(list[0].collection_id).toBe(c.collection_id);
  });

  test("members with non-matching obs_name silently drop (current_count < created_count)", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const res = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "drift-test",
        members: [
          { dataset_key: "A", obs_name: "cell_0" },
          { dataset_key: "A", obs_name: "ghost_obs" },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const env = await res.json();
    const c = env.result;
    expect(c.created_count).toBe(2);
    expect(c.current_count).toBe(1);
  });

  test("single-dataset store resolves without _dataset column", async () => {
    const store = await makeSingleDatasetStore();
    activeStore = store;
    const server = bootServer(store);

    const res = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "single-ds",
        members: [
          { dataset_key: "A", obs_name: "cell_0" },
          { dataset_key: "A", obs_name: "cell_5" },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const env = await res.json();
    const c = env.result;
    expect(c.current_count).toBe(2);
  });

  test("row_indices path resolves obs_name server-side (multi-dataset)", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    // Mix of dataset A and B rows
    const indices = [0, 1, 2, 30, 31, 49];
    const res = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "from-row-indices",
        row_indices: indices,
      }),
    });
    expect(res.status).toBe(201);
    const env = await res.json();
    const c = env.result;
    expect(c.created_count).toBe(indices.length);
    expect(c.current_count).toBe(indices.length);
    // Multi-dataset spread: drift breakdown should list both A and B
    expect(c.drift.map((d: { dataset_key: string }) => d.dataset_key).toSorted()).toEqual(["A", "B"]);
  });

  test("row_indices path scales to thousands without crashing", async () => {
    const store = await makeStore(); // 50 obs total
    activeStore = store;
    const server = bootServer(store);

    // Repeat indices to simulate a large input — INSERT OR IGNORE dedupes
    const indices: number[] = [];
    for (let pass = 0; pass < 200; pass++) for (let i = 0; i < 50; i++) indices.push(i);

    const res = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bulk-test", row_indices: indices }),
    });
    expect(res.status).toBe(201);
    const env = await res.json();
    const c = env.result;
    expect(c.created_count).toBe(indices.length);
    // After dedupe by (dataset_key, obs_index): 50 unique rows
    expect(c.current_count).toBe(50);
  });

  test("from_scatter_selection path uses populated temp table", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    // Stage a selection via the existing scatter-selection endpoint.
    const stage = await fetch(`http://localhost:${server.port}/api/scatter-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row_indices: [0, 1, 2, 30, 31] }),
    });
    expect(stage.status).toBe(200);

    // Tiny create body — server reads from __scatter_selection.
    const res = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "from-temp-table",
        from_scatter_selection: true,
      }),
    });
    expect(res.status).toBe(201);
    const env = await res.json();
    const c = env.result;
    expect(c.created_count).toBe(5);
    expect(c.current_count).toBe(5);
  });

  test("from_scatter_selection without staged selection returns 500 with clear error", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const res = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "no-selection", from_scatter_selection: true }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    // toUserError() maps the underlying "__scatter_selection does not exist"
    // / "is empty" message to a fixed user-facing string.
    expect(body.error).toMatch(/No selection to save/);
  });

  test("synthetic obs_name dataset stamps provenance.synthetic_identity", async () => {
    const store = await makeSyntheticStore();
    activeStore = store;
    expect(store.obsNameOrigin).toBe("synthetic");
    const server = bootServer(store);

    const res = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "synthetic-ok",
        // Single-dataset store joins by obs_name only; dataset_key is just stored.
        members: [
          { dataset_key: "default", obs_name: "0" },
          { dataset_key: "default", obs_name: "1" },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const env = await res.json();
    const c = env.result;
    expect(c.provenance).toEqual({ synthetic_identity: true });
  });

  test("rejects empty member list", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const res = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "empty", members: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("SQL injection attempt in name is stored verbatim, not executed", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const malicious = "Robert'); DROP TABLE collections; --";
    const res = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DEFAULT_BODY({ name: malicious })),
    });
    expect(res.status).toBe(201);
    const env = await res.json();
    const c = env.result;
    expect(c.name).toBe(malicious);

    const list = await fetch(`http://localhost:${server.port}/api/collections`).then((r) => r.json());
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe(malicious);
  });
});

describe("collections routes — patch", () => {
  test("rename + recolor with correct version succeeds", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const create = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DEFAULT_BODY()),
    })
      .then((r) => r.json())
      .then((env) => env.result);

    const res = await fetch(`http://localhost:${server.port}/api/collections/${create.collection_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "renamed",
        color: "#00ff00",
        version: 1,
      }),
    });
    expect(res.status).toBe(200);
    const c = await res.json();
    expect(c.name).toBe("renamed");
    expect(c.color).toBe("#00ff00");
    expect(c.version).toBe(2);
  });

  test("PATCH with stale version returns 409", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const create = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DEFAULT_BODY()),
    })
      .then((r) => r.json())
      .then((env) => env.result);

    const res = await fetch(`http://localhost:${server.port}/api/collections/${create.collection_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", version: 99 }),
    });
    expect(res.status).toBe(409);
  });

  test("PATCH replaces tags entirely (set semantics)", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const create = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DEFAULT_BODY({ tags: ["a", "b", "c"] })),
    })
      .then((r) => r.json())
      .then((env) => env.result);

    const res = await fetch(`http://localhost:${server.port}/api/collections/${create.collection_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["x"], version: 1 }),
    });
    expect(res.status).toBe(200);
    const c = await res.json();
    expect(c.tags).toEqual(["x"]);
  });

  test("PATCH on missing id returns 404", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const res = await fetch(`http://localhost:${server.port}/api/collections/00000000-0000-0000-0000-000000000000`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", version: 0 }),
    });
    expect(res.status).toBe(404);
  });
});

describe("collections routes — append members", () => {
  test("POST /:id/members appends and bumps version", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const create = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "base", row_indices: [0, 1, 2] }),
    })
      .then((r) => r.json())
      .then((env) => env.result);
    expect(create.created_count).toBe(3);
    expect(create.current_count).toBe(3);
    expect(create.version).toBe(1);

    const append = await fetch(`http://localhost:${server.port}/api/collections/${create.collection_id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // AppendMembersBodySchema does NOT accept `name` (split from create schema in PR2).
      body: JSON.stringify({ row_indices: [3, 4, 5] }),
    });
    expect(append.status).toBe(200);
    const env = await append.json();
    const updated = env.result;
    expect(updated.created_count).toBe(3); // immutable
    expect(updated.current_count).toBe(6); // grew
    expect(updated.version).toBe(2); // bumped
    expect(env.stats).toEqual({ total: 3, added: 3, already_member: 0 });
  });

  test("POST /:id/members dedupes (PK on (id, dataset_key, obs_index))", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const create = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dedupe-test", row_indices: [0, 1, 2] }),
    })
      .then((r) => r.json())
      .then((env) => env.result);

    const appendEnv = await fetch(`http://localhost:${server.port}/api/collections/${create.collection_id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Overlap: 1, 2, 3 → only 3 is new
      body: JSON.stringify({ row_indices: [1, 2, 3] }),
    }).then((r) => r.json());

    expect(appendEnv.result.current_count).toBe(4); // 0,1,2,3 (1 and 2 deduped)
    expect(appendEnv.stats).toEqual({ total: 3, added: 1, already_member: 2 });
  });

  test("POST /:id/members on missing id returns 404", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const res = await fetch(
      `http://localhost:${server.port}/api/collections/00000000-0000-0000-0000-000000000000/members`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "ignored", row_indices: [0] }),
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("active-selection routes", () => {
  test("POST /api/active-selection sets predicate + temp table; row-indices returns binary uint32", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const create = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "for-activate", row_indices: [0, 1, 2, 30] }),
    })
      .then((r) => r.json())
      .then((env) => env.result);

    const res = await fetch(`http://localhost:${server.port}/api/active-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_ids: [create.collection_id] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.resolved_count).toBe(4);
    expect(typeof body.version).toBe("number");
    // Multi-dataset store → predicate uses (_dataset, __obs_index__) tuple form
    expect(body.predicate).toMatch(/_dataset.*__obs_index__.*IN.*__active_selection/);
    // Token rides as inline SQL comment for Mosaic cache busting
    expect(body.predicate).toContain(`tok=${body.token}`);

    // GET /row-indices returns binary uint32 LE (4 * resolved_count bytes)
    const idx = await fetch(`http://localhost:${server.port}/api/active-selection/row-indices`);
    expect(idx.status).toBe(200);
    const buf = new Uint32Array(await idx.arrayBuffer());
    expect(buf.length).toBe(4);
    // multi-dataset rows align to row indices but the order is dataset-dependent;
    // assert membership rather than ordering
    expect(new Set(buf)).toEqual(new Set([0, 1, 2, 30]));
  });

  test("POST /api/active-selection with empty collection_ids clears", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const create = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "tmp", row_indices: [0, 1, 2] }),
    })
      .then((r) => r.json())
      .then((env) => env.result);

    await fetch(`http://localhost:${server.port}/api/active-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_ids: [create.collection_id] }),
    });

    const clear = await fetch(`http://localhost:${server.port}/api/active-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_ids: [] }),
    });
    expect(clear.status).toBe(200);

    // Row-indices now empty
    const idx = await fetch(`http://localhost:${server.port}/api/active-selection/row-indices`);
    const buf = await idx.arrayBuffer();
    expect(buf.byteLength).toBe(0);
  });

  test("POST /api/active-selection rejects multi-active with 400", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const res = await fetch(`http://localhost:${server.port}/api/active-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collection_ids: ["00000000-0000-0000-0000-000000000000", "11111111-1111-1111-1111-111111111111"],
      }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/active-selection 404 for unknown collection", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const res = await fetch(`http://localhost:${server.port}/api/active-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_ids: ["00000000-0000-0000-0000-000000000000"] }),
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/active-selection drops the temp table", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const create = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "tmp", row_indices: [0, 1, 2] }),
    })
      .then((r) => r.json())
      .then((env) => env.result);

    await fetch(`http://localhost:${server.port}/api/active-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_ids: [create.collection_id] }),
    });

    const del = await fetch(`http://localhost:${server.port}/api/active-selection`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await del.json()).ok).toBe(true);

    const idx = await fetch(`http://localhost:${server.port}/api/active-selection/row-indices`);
    const buf = await idx.arrayBuffer();
    expect(buf.byteLength).toBe(0);
  });

  test("Re-activating same collection mints a fresh token (Mosaic cache busts)", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const create = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "tmp", row_indices: [0, 1, 2] }),
    })
      .then((r) => r.json())
      .then((env) => env.result);

    const a = await fetch(`http://localhost:${server.port}/api/active-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_ids: [create.collection_id] }),
    }).then((r) => r.json());
    const b = await fetch(`http://localhost:${server.port}/api/active-selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_ids: [create.collection_id] }),
    }).then((r) => r.json());

    expect(a.token).not.toBe(b.token);
    expect(b.version).toBeGreaterThan(a.version);
  });
});

describe("collections routes — delete", () => {
  test("soft delete hides from list, second delete returns 404", async () => {
    const store = await makeStore();
    activeStore = store;
    const server = bootServer(store);

    const create = await fetch(`http://localhost:${server.port}/api/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DEFAULT_BODY()),
    })
      .then((r) => r.json())
      .then((env) => env.result);

    const del = await fetch(`http://localhost:${server.port}/api/collections/${create.collection_id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);

    const list = await fetch(`http://localhost:${server.port}/api/collections`).then((r) => r.json());
    expect(list).toEqual([]);

    const del2 = await fetch(`http://localhost:${server.port}/api/collections/${create.collection_id}`, {
      method: "DELETE",
    });
    expect(del2.status).toBe(404);
  });
});
