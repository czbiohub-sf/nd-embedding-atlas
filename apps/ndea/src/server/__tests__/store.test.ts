/**
 * Tests for DatasetQuerySession + Mosaic query protocol.
 */

import { describe, expect, test, afterEach } from "bun:test";
import { DatasetQuerySession } from "../store.ts";
import { handleMosaicQuery, isAllowedSql } from "../mosaic.ts";
import { cropFovColumn, detectSpatialColumns, parseBbox } from "../state.ts";
import type { DuckDBConnection } from "@duckdb/node-api";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a DatasetQuerySession with mock obs data via SQL. */
function createMockStore(n = 100, options?: { hidden?: Set<string> }): Promise<DatasetQuerySession> {
  return DatasetQuerySession.fromInit(async (conn: DuckDBConnection) => {
    // Build VALUES clause
    const rows: string[] = [];
    for (let i = 0; i < n; i++) {
      const cat = i % 3 === 0 ? "A" : i % 3 === 1 ? "B" : "C";
      const val = (Math.random() * 100).toFixed(2);
      rows.push(`(${i}, 'obs_${i}', 'test_dataset', '${cat}', ${val}::FLOAT)`);
    }
    await conn.run(
      `CREATE TABLE obs_base AS SELECT * FROM (VALUES ${rows.join(", ")}) AS t(__row_index__, obs_name, _dataset, category, value)`,
    );
  }, options);
}

// ─── Store lifecycle helper ──────────────────────────────────────────────────

let activeStore: DatasetQuerySession | null = null;

afterEach(() => {
  if (activeStore) {
    activeStore.close();
    activeStore = null;
  }
});

// ─── DatasetQuerySession tests ───────────────────────────────────────────────

describe("DatasetQuerySession", () => {
  test("create from init callback and query row count", async () => {
    const store = await createMockStore(50);
    activeStore = store;

    expect(store.nObs).toBe(50);

    const rows = await store.queryJson("SELECT COUNT(*) AS cnt FROM obs_base");
    expect(Number(rows[0].cnt)).toBe(50);
  });

  test("dataset VIEW exists after creation", async () => {
    const store = await createMockStore(10);
    activeStore = store;

    const rows = await store.queryJson("SELECT COUNT(*) AS cnt FROM dataset");
    expect(Number(rows[0].cnt)).toBe(10);
  });

  test("queryJson returns array of objects", async () => {
    const store = await createMockStore(5);
    activeStore = store;

    const rows = await store.queryJson("SELECT obs_name FROM obs_base ORDER BY __row_index__ LIMIT 3");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveProperty("obs_name");
    expect(rows[0].obs_name).toBe("obs_0");
    expect(rows[2].obs_name).toBe("obs_2");
  });

  test("queryArrow returns Uint8Array", async () => {
    const store = await createMockStore(10);
    activeStore = store;

    const result = await store.queryArrow("SELECT * FROM dataset LIMIT 5");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  test("hidden columns are excluded from VIEW", async () => {
    const store = await createMockStore(5, { hidden: new Set(["category"]) });
    activeStore = store;

    // category should not be in the VIEW
    const rows = await store.queryJson("SELECT * FROM dataset LIMIT 1");
    expect(rows[0]).not.toHaveProperty("category");

    // But it should still be in obs_base
    const obsRows = await store.queryJson("SELECT category FROM obs_base LIMIT 1");
    expect(obsRows[0]).toHaveProperty("category");
  });

  test("close does not throw", async () => {
    const store = await createMockStore(5);
    // Don't assign to activeStore: we close it manually here
    expect(() => store.close()).not.toThrow();
  });
});

// ─── SQL filter tests ────────────────────────────────────────────────────────

describe("isAllowedSql", () => {
  test("allows SELECT queries", () => {
    expect(isAllowedSql("SELECT * FROM dataset")).toBe(true);
    expect(isAllowedSql("  SELECT COUNT(*) FROM obs_base")).toBe(true);
  });

  test("allows Mosaic preagg CREATE TABLE", () => {
    expect(isAllowedSql("CREATE TABLE mosaic.preagg_scatter AS SELECT ...")).toBe(true);
  });

  test("allows CREATE SCHEMA", () => {
    expect(isAllowedSql("CREATE SCHEMA mosaic")).toBe(true);
  });

  test("allows DROP TABLE IF EXISTS for preagg cleanup", () => {
    expect(isAllowedSql("DROP TABLE IF EXISTS mosaic.preagg_scatter")).toBe(true);
  });

  test("blocks ALTER TABLE via /data/query: goes through /api/categorize instead", () => {
    expect(isAllowedSql('ALTER TABLE obs_base ADD COLUMN "__ev__umap_id" INTEGER')).toBe(false);
  });

  test("blocks UPDATE via /data/query: goes through /api/categorize instead", () => {
    expect(isAllowedSql('UPDATE obs_base SET "__ev__umap_id" = 42')).toBe(false);
  });

  test("blocks CREATE OR REPLACE VIEW via /data/query: server owns VIEW rebuilds", () => {
    expect(isAllowedSql("CREATE OR REPLACE VIEW dataset AS SELECT * FROM obs_base")).toBe(false);
  });

  test("blocks DROP TABLE (without IF EXISTS)", () => {
    expect(isAllowedSql("DROP TABLE obs_base")).toBe(false);
  });

  test("blocks DELETE", () => {
    expect(isAllowedSql("DELETE FROM obs_base WHERE __row_index__ = 1")).toBe(false);
  });

  test("blocks INSERT", () => {
    expect(isAllowedSql("INSERT INTO obs_base VALUES (...)")).toBe(false);
  });

  test("blocks UPDATE on non-obs_base tables", () => {
    expect(isAllowedSql("UPDATE some_other_table SET x = 1")).toBe(false);
  });

  test("blocks ATTACH", () => {
    expect(isAllowedSql("ATTACH '/tmp/evil.db'")).toBe(false);
  });

  test("blocks COPY", () => {
    expect(isAllowedSql("COPY obs_base TO '/tmp/stolen.csv'")).toBe(false);
  });

  test("blocks EXPORT", () => {
    expect(isAllowedSql("EXPORT DATABASE '/tmp/'")).toBe(false);
  });
});

// ─── Mosaic query handler tests ──────────────────────────────────────────────

describe("handleMosaicQuery", () => {
  test("exec command returns empty JSON", async () => {
    const store = await createMockStore(5);
    activeStore = store;

    const res = await handleMosaicQuery({ type: "exec", sql: "CREATE SCHEMA IF NOT EXISTS mosaic" }, store);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({});
  });

  test("json command returns row objects", async () => {
    const store = await createMockStore(10);
    activeStore = store;

    const res = await handleMosaicQuery({ type: "json", sql: "SELECT DISTINCT _dataset FROM dataset" }, store);
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0]._dataset).toBe("test_dataset");
  });

  test("arrow command returns Arrow IPC bytes", async () => {
    const store = await createMockStore(10);
    activeStore = store;

    const res = await handleMosaicQuery(
      { type: "arrow", sql: "SELECT __row_index__, category FROM dataset LIMIT 5" },
      store,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.apache.arrow.stream");

    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  test("blocked SQL returns 400", async () => {
    const store = await createMockStore(5);
    activeStore = store;

    const res = await handleMosaicQuery({ type: "exec", sql: "DROP TABLE obs_base" }, store);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not allowed");
  });

  test("preagg CREATE TABLE is allowed", async () => {
    const store = await createMockStore(10);
    activeStore = store;

    // Create mosaic schema first
    await handleMosaicQuery({ type: "exec", sql: "CREATE SCHEMA IF NOT EXISTS mosaic" }, store);

    // Create preagg table
    const res = await handleMosaicQuery(
      {
        type: "exec",
        sql: "CREATE TABLE mosaic.preagg_scatter AS SELECT category, COUNT(*) AS cnt FROM dataset GROUP BY category",
      },
      store,
    );
    expect(res.status).toBe(200);

    // Verify it exists
    const checkRes = await handleMosaicQuery(
      { type: "json", sql: "SELECT * FROM mosaic.preagg_scatter ORDER BY category" },
      store,
    );
    expect(checkRes.status).toBe(200);
    const rows = await checkRes.json();
    expect(rows.length).toBeGreaterThan(0);
  });

  test("missing sql/type returns 400", async () => {
    const store = await createMockStore(5);
    activeStore = store;

    const res = await handleMosaicQuery({ type: "", sql: "" }, store);
    expect(res.status).toBe(400);
  });

  test("invalid SQL returns 500", async () => {
    const store = await createMockStore(5);
    activeStore = store;

    const res = await handleMosaicQuery({ type: "json", sql: "SELECT * FROM nonexistent_table_xyz" }, store);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("unknown command returns 400", async () => {
    const store = await createMockStore(5);
    activeStore = store;

    const res = await handleMosaicQuery({ type: "csv", sql: "SELECT * FROM dataset" }, store);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Unknown command");
  });
});

// ─── Spatial detection tests ─────────────────────────────────────────────────

describe("detectSpatialColumns", () => {
  test("detects fov_name + bbox + x/y", () => {
    const cols = new Set(["fov_name", "bbox", "x", "y", "category"]);
    const result = detectSpatialColumns(cols);
    expect(result.fov).toBe("fov_name");
    expect(cropFovColumn(result)).toBe("fov_name");
    expect(result.bbox).toBe("bbox");
    expect(result.x).toBe("x");
    expect(result.y).toBe("y");
  });

  test("detects well as fov fallback", () => {
    const cols = new Set(["well", "value"]);
    const result = detectSpatialColumns(cols);
    expect(result.fov).toBe("well");
    expect(cropFovColumn(result)).toBeNull();
  });

  test("detects cp_bbox as bbox fallback", () => {
    const cols = new Set(["cp_bbox"]);
    const result = detectSpatialColumns(cols);
    expect(result.bbox).toBe("cp_bbox");
  });

  test("detects x_cp1/y_cp1 coordinate pair", () => {
    const cols = new Set(["x_cp1", "y_cp1"]);
    const result = detectSpatialColumns(cols);
    expect(result.x).toBe("x_cp1");
    expect(result.y).toBe("y_cp1");
  });

  test("returns nulls when no spatial columns", () => {
    const cols = new Set(["category", "value"]);
    const result = detectSpatialColumns(cols);
    expect(result.fov).toBeNull();
    expect(result.bbox).toBeNull();
    expect(result.x).toBeNull();
    expect(result.y).toBeNull();
  });
});

// ─── Bbox parsing tests ─────────────────────────────────────────────────────

describe("parseBbox", () => {
  test("parses valid bbox string", () => {
    const result = parseBbox("[44055 98779 44238 98919]");
    expect(result).not.toBeNull();
    expect(result!.yMin).toBe(44055);
    expect(result!.xMin).toBe(98779);
    expect(result!.yMax).toBe(44238);
    expect(result!.xMax).toBe(98919);
  });

  test("returns null for malformed bbox", () => {
    expect(parseBbox("[1 2 3]")).toBeNull();
    expect(parseBbox("not a bbox")).toBeNull();
    expect(parseBbox("[a b c d]")).toBeNull();
  });
});
