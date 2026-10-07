/**
 * Tests for the annotation feature: injection defense, table-name collisions,
 * value round-trip through the dataset VIEW, drop, and sidecar persistence.
 *
 * The injection + collision cases guard the findings from the adversarial
 * review: they fail loudly if the quoteIdent / annTableName fixes regress.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { DatasetQuerySession } from "../store.ts";
import { annotateObservations } from "../observations.ts";
import { createServerSession } from "../state.ts";
import { handleWriteAnnotationValues } from "../routes/annotate.ts";

function createMockStore(n = 20): Promise<DatasetQuerySession> {
  return DatasetQuerySession.fromInit(async (conn: DuckDBConnection) => {
    const rows: string[] = [];
    for (let i = 0; i < n; i++) rows.push(`(${i}, 'obs_${i}', 'ds')`);
    await conn.run(
      `CREATE TABLE obs_base AS SELECT * FROM (VALUES ${rows.join(", ")}) AS t(__row_index__, obs_name, _dataset)`,
    );
  });
}

let activeStore: DatasetQuerySession | null = null;
const tmpFiles: string[] = [];

afterEach(async () => {
  if (activeStore) {
    activeStore.close();
    activeStore = null;
  }
  for (const f of tmpFiles.splice(0)) await rm(f, { force: true });
});

describe("annotations: injection defense", () => {
  test("malicious column name cannot break out of the quoted identifier", async () => {
    const store = await createMockStore(10);
    activeStore = store;

    // A name engineered to close the identifier and drop obs_base. quoteIdent
    // must double the embedded quote so the whole thing stays one identifier.
    const evil = 'x" TEXT); DROP TABLE obs_base;--';
    await store.registerAnnotationColumn(evil);

    // obs_base must still exist: injection neutralized.
    const rows = await store.queryJson("SELECT COUNT(*) AS cnt FROM obs_base");
    expect(Number(rows[0].cnt)).toBe(10);

    // And the column exists literally under its (weird) name, writeable + readable.
    await store.writeAnnotationValues(evil, [{ rowIndex: 0, datasetKey: "ds", obsName: "obs_0", value: "ok" }]);
    const got = await store.queryJson(`SELECT "${evil.replace(/"/g, '""')}" AS v FROM dataset WHERE __row_index__ = 0`);
    expect(got[0].v).toBe("ok");
  });

  test("stacked annotate predicate is refused and creates nothing", async () => {
    const store = await createMockStore(10);
    activeStore = store;
    await store.registerAnnotationColumn("label");
    const response = await handleWriteAnnotationValues(
      new Request("http://x/api/annotations/values", {
        method: "POST",
        body: JSON.stringify({ column: "label", label: "bad", predicate: "1=1); CREATE TABLE pwned (x INT); --" }),
      }),
      createServerSession({ store }),
    );
    expect(response.status).toBe(500);
    expect(
      await store.queryJson("SELECT table_name FROM information_schema.tables WHERE table_name = 'pwned'"),
    ).toEqual([]);
    expect(await store.queryJson("SELECT count(*) AS n FROM dataset WHERE label IS NOT NULL")).toEqual([{ n: 0 }]);
  });
});

describe("annotations: table-name collisions", () => {
  test("distinct names that sanitize to the same stem keep separate data", async () => {
    const store = await createMockStore(10);
    activeStore = store;

    // 'col 1' and 'col-1' both sanitize to stem 'col_1': the hash suffix must
    // keep them in distinct tables so the second create can't wipe the first.
    await store.registerAnnotationColumn("col 1");
    await store.writeAnnotationValues("col 1", [{ rowIndex: 0, datasetKey: "ds", obsName: "obs_0", value: "first" }]);
    await store.registerAnnotationColumn("col-1");
    await store.writeAnnotationValues("col-1", [{ rowIndex: 0, datasetKey: "ds", obsName: "obs_0", value: "second" }]);

    const row = await store.queryJson(`SELECT "col 1" AS a, "col-1" AS b FROM dataset WHERE __row_index__ = 0`);
    expect(row[0].a).toBe("first");
    expect(row[0].b).toBe("second");
  });
});

describe("annotations: lifecycle", () => {
  test("value round-trips through the dataset VIEW; NULL for unannotated rows", async () => {
    const store = await createMockStore(5);
    activeStore = store;

    await store.registerAnnotationColumn("label");
    await store.writeAnnotationValues("label", [{ rowIndex: 1, datasetKey: "ds", obsName: "obs_1", value: "hit" }]);

    const rows = await store.queryJson(`SELECT __row_index__ AS i, "label" AS v FROM dataset ORDER BY i`);
    expect(rows[1].v).toBe("hit");
    expect(rows[0].v).toBeNull();
  });

  test("drop removes the column from the VIEW", async () => {
    const store = await createMockStore(5);
    activeStore = store;

    await store.registerAnnotationColumn("temp");
    expect(store.hasAnnotationColumn("temp")).toBe(true);
    await store.dropAnnotationColumn("temp");
    expect(store.hasAnnotationColumn("temp")).toBe(false);
    expect(await store.datasetColumnExists("temp")).toBe(false);
  });

  test("datasetColumnExists detects obs_base columns", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    expect(await store.datasetColumnExists("obs_name")).toBe(true);
    expect(await store.datasetColumnExists("nope")).toBe(false);
  });
});

describe("annotations: from predicate (node-graph batch door)", () => {
  test("stamps a label onto every obs matching the predicate and returns the count", async () => {
    const store = await createMockStore(10);
    activeStore = store;

    await store.registerAnnotationColumn("infection_corrected");
    const n = await annotateObservations(store, "infection_corrected", "uninfected", "__row_index__ < 4");

    expect(n).toBe(4);
    const rows = await store.queryJson(`SELECT __row_index__ AS i, "infection_corrected" AS v FROM dataset ORDER BY i`);
    const labeled = rows.filter((r) => r.v === "uninfected").map((r) => Number(r.i));
    expect(labeled).toEqual([0, 1, 2, 3]);
    expect(rows[9].v).toBeNull(); // unmatched rows stay NULL
  });

  test("re-applying overwrites prior labels for the matched rows (upsert)", async () => {
    const store = await createMockStore(10);
    activeStore = store;

    await store.registerAnnotationColumn("label");
    await annotateObservations(store, "label", "a", "__row_index__ < 6");
    await annotateObservations(store, "label", "b", "__row_index__ < 3");

    const rows = await store.queryJson(`SELECT __row_index__ AS i, "label" AS v FROM dataset ORDER BY i`);
    expect(rows.map((r) => r.v).slice(0, 6)).toEqual(["b", "b", "b", "a", "a", "a"]);
  });
});

describe("annotations: sidecar", () => {
  test("save → load round-trips columns and values", async () => {
    const path = join(tmpdir(), `ndea-test-sidecar-${process.pid}-${Date.now()}.parquet`);
    tmpFiles.push(path);

    const a = await createMockStore(8);
    await a.registerAnnotationColumn("region");
    await a.writeAnnotationValues("region", [{ rowIndex: 2, datasetKey: "ds", obsName: "obs_2", value: "north" }]);
    await a.saveAnnotationsSidecar(path);
    a.close();

    const b = await createMockStore(8);
    activeStore = b;
    await b.loadAnnotationsSidecar(path);
    expect(b.hasAnnotationColumn("region")).toBe(true);
    const rows = await b.queryJson(`SELECT "region" AS v FROM dataset WHERE __row_index__ = 2`);
    expect(rows[0].v).toBe("north");
  });

  test("saving with no columns removes a stale sidecar (deletions persist)", async () => {
    const path = join(tmpdir(), `ndea-test-sidecar-empty-${process.pid}-${Date.now()}.parquet`);
    tmpFiles.push(path);

    const store = await createMockStore(5);
    activeStore = store;
    await store.registerAnnotationColumn("gone");
    await store.saveAnnotationsSidecar(path);
    expect(await Bun.file(path).exists()).toBe(true);

    await store.dropAnnotationColumn("gone");
    await store.saveAnnotationsSidecar(path);
    expect(await Bun.file(path).exists()).toBe(false);
  });
});

describe("annotations: dtype", () => {
  test("integer column stores numbers and rejects non-integers", async () => {
    const store = await createMockStore(10);
    activeStore = store;

    await store.registerAnnotationColumn("count", "integer");
    expect(store.annotationColumns.get("count")?.dtype).toBe("integer");

    await store.writeAnnotationValues("count", [{ rowIndex: 1, datasetKey: "ds", obsName: "obs_1", value: "42" }]);
    const row = await store.queryJson(`SELECT "count" AS v FROM dataset WHERE __row_index__ = 1`);
    expect(row[0].v).toBe(42); // numeric, not the string "42"

    // A non-integer label must be rejected before it reaches the typed column.
    await expect(
      store.writeAnnotationValues("count", [{ rowIndex: 2, datasetKey: "ds", obsName: "obs_2", value: "abc" }]),
    ).rejects.toThrow(/not an integer/);
  });

  test("sidecar round-trips dtype (integer survives reload)", async () => {
    const path = join(tmpdir(), `ndea-test-sidecar-int-${process.pid}-${Date.now()}.parquet`);
    tmpFiles.push(path);

    const a = await createMockStore(8);
    await a.registerAnnotationColumn("score", "integer");
    await a.writeAnnotationValues("score", [{ rowIndex: 3, datasetKey: "ds", obsName: "obs_3", value: "7" }]);
    await a.saveAnnotationsSidecar(path);
    a.close();

    const b = await createMockStore(8);
    activeStore = b;
    await b.loadAnnotationsSidecar(path);
    expect(b.annotationColumns.get("score")?.dtype).toBe("integer");
    const rows = await b.queryJson(`SELECT "score" AS v FROM dataset WHERE __row_index__ = 3`);
    expect(rows[0].v).toBe(7);
  });
});
