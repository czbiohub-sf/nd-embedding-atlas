/**
 * Tests for annotation fields: injection defense, table-name collisions,
 * value round-trip through the dataset VIEW, rename/convert/drop, and
 * sidecar persistence.
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
import { createServerSession } from "../state.ts";
import { handlePatchAnnotationColumn, handleWriteAnnotationValues } from "../routes/annotations.ts";

function createMockStore(n = 20): Promise<DatasetQuerySession> {
  return DatasetQuerySession.fromInit(async (conn: DuckDBConnection) => {
    const rows: string[] = [];
    for (let i = 0; i < n; i++) rows.push(`(${i}, 'obs_${i}', 'ds')`);
    await conn.run(
      `CREATE TABLE obs_base AS SELECT * FROM (VALUES ${rows.join(", ")}) AS t(__row_index__, obs_name, _dataset)`,
    );
  });
}

/** Handlers never read the method; the router dispatches on it. */
const post = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body) });

function sidecarPath(tag: string): string {
  const path = join(tmpdir(), `ndea-test-sidecar-${tag}-${process.pid}-${Date.now()}.parquet`);
  tmpFiles.push(path);
  return path;
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
  test("malicious field name cannot break out of the quoted identifier", async () => {
    const store = await createMockStore(10);
    activeStore = store;

    // A name engineered to close the identifier and drop obs_base. quoteIdent
    // must double the embedded quote so the whole thing stays one identifier.
    const evil = 'x" TEXT); DROP TABLE obs_base;--';
    await store.registerAnnotationColumn(evil);

    // obs_base must still exist: injection neutralized.
    const rows = await store.queryJson("SELECT COUNT(*) AS cnt FROM obs_base");
    expect(Number(rows[0].cnt)).toBe(10);

    // And the field exists literally under its (weird) name, writeable + readable.
    await store.writeAnnotationValues(evil, [{ rowIndex: 0, value: "ok" }]);
    const got = await store.queryJson(`SELECT "${evil.replace(/"/g, '""')}" AS v FROM dataset WHERE __row_index__ = 0`);
    expect(got[0].v).toBe("ok");
  });
});

describe("annotations: table-name collisions", () => {
  test("distinct names that sanitize to the same stem keep separate data", async () => {
    const store = await createMockStore(10);
    activeStore = store;

    // 'col 1' and 'col-1' both sanitize to stem 'col_1': the hash suffix must
    // keep them in distinct tables so the second create can't wipe the first.
    await store.registerAnnotationColumn("col 1");
    await store.writeAnnotationValues("col 1", [{ rowIndex: 0, value: "first" }]);
    await store.registerAnnotationColumn("col-1");
    await store.writeAnnotationValues("col-1", [{ rowIndex: 0, value: "second" }]);

    const row = await store.queryJson(`SELECT "col 1" AS a, "col-1" AS b FROM dataset WHERE __row_index__ = 0`);
    expect(row[0].a).toBe("first");
    expect(row[0].b).toBe("second");
  });
});

describe("annotations: values", () => {
  test("writes by rowIndex resolve obs identity; null clears; unknown rows are skipped", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    await store.registerAnnotationColumn("label");
    const state = createServerSession({ store });

    const write = async (rows: unknown[]) =>
      (await handleWriteAnnotationValues(post({ column: "label", rows }), state)).json();
    expect(
      await write([
        { rowIndex: 1, value: "hit" },
        { rowIndex: 3, value: "miss" },
        { rowIndex: 99, value: "nowhere" },
      ]),
    ).toEqual({ ok: true, n: 2 });

    const table = store.annotationColumns.get("label")!.table;
    expect(
      await store.queryJson(`SELECT __row_index__ AS i, dataset_key, obs_name, label FROM ${table} ORDER BY i`),
    ).toEqual([
      { i: 1, dataset_key: "ds", obs_name: "obs_1", label: "hit" },
      { i: 3, dataset_key: "ds", obs_name: "obs_3", label: "miss" },
    ]);

    expect(await write([{ rowIndex: 1, value: null }])).toEqual({ ok: true, n: 1 });
    const rows = await store.queryJson(`SELECT __row_index__ AS i, "label" AS v FROM dataset ORDER BY i`);
    expect(rows.map((r) => r.v)).toEqual([null, null, null, "miss", null]);
  });

  test("unknown field is 404; an empty batch is 400", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    const state = createServerSession({ store });
    expect(
      (await handleWriteAnnotationValues(post({ column: "nope", rows: [{ rowIndex: 0, value: "x" }] }), state)).status,
    ).toBe(404);
    expect((await handleWriteAnnotationValues(post({ column: "nope", rows: [] }), state)).status).toBe(400);
  });
});

describe("annotations: lifecycle", () => {
  test("drop removes the field from the VIEW", async () => {
    const store = await createMockStore(5);
    activeStore = store;

    await store.registerAnnotationColumn("temp");
    expect(store.hasAnnotationColumn("temp")).toBe(true);
    expect(store.columns().get("temp")).toEqual({ sqlType: "VARCHAR", kind: "annotation" });
    await store.dropAnnotationColumn("temp");
    expect(store.hasAnnotationColumn("temp")).toBe(false);
    expect(store.columns().has("temp")).toBe(false);
  });

  test("columns() catalogs the VIEW's obs_base columns", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    expect(store.columns().get("obs_name")).toEqual({ sqlType: "VARCHAR", kind: "obs" });
    expect(store.columns().has("nope")).toBe(false);
  });

  test("rename keeps values and the VIEW shows only the new name", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    await store.registerAnnotationColumn("old");
    await store.writeAnnotationValues("old", [{ rowIndex: 2, value: "kept" }]);
    const state = createServerSession({ store });

    const response = await handlePatchAnnotationColumn("old", post({ name: "new name" }), state);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ column: "new name", dtype: "label" });

    expect(store.columns().has("old")).toBe(false);
    expect(store.columns().get("new name")).toEqual({ sqlType: "VARCHAR", kind: "annotation" });
    expect([...store.annotationColumns.keys()]).toEqual(["new name"]);
    expect(await store.queryJson(`SELECT "new name" AS v FROM dataset WHERE __row_index__ = 2`)).toEqual([
      { v: "kept" },
    ]);

    // Upserts still work on the renamed table (primary key carried over).
    await store.writeAnnotationValues("new name", [{ rowIndex: 2, value: "again" }]);
    expect(await store.queryJson(`SELECT "new name" AS v FROM dataset WHERE __row_index__ = 2`)).toEqual([
      { v: "again" },
    ]);
  });

  test("patch refuses collisions (409), unknown fields (404), and empty bodies (400)", async () => {
    const store = await createMockStore(5);
    activeStore = store;
    await store.registerAnnotationColumn("a");
    await store.registerAnnotationColumn("b");
    const state = createServerSession({ store });
    const patch = (name: string, body: unknown) => handlePatchAnnotationColumn(name, post(body), state);

    expect((await patch("a", { name: "b" })).status).toBe(409);
    expect((await patch("a", { name: "obs_name" })).status).toBe(409);
    expect((await patch("nope", { name: "c" })).status).toBe(404);
    expect((await patch("a", {})).status).toBe(400);
    expect([...store.annotationColumns.keys()]).toEqual(["a", "b"]);
  });
});

describe("annotations: sidecar", () => {
  test("save → load round-trips fields and values; reloaded tables still upsert", async () => {
    const path = sidecarPath("rt");

    const a = await createMockStore(8);
    await a.registerAnnotationColumn("region");
    await a.writeAnnotationValues("region", [{ rowIndex: 2, value: "north" }]);
    await a.saveAnnotationsSidecar(path);
    a.close();

    const b = await createMockStore(8);
    activeStore = b;
    await b.loadAnnotationsSidecar(path);
    expect(b.hasAnnotationColumn("region")).toBe(true);
    expect(await b.queryJson(`SELECT "region" AS v FROM dataset WHERE __row_index__ = 2`)).toEqual([{ v: "north" }]);
    await b.writeAnnotationValues("region", [{ rowIndex: 2, value: "south" }]);
    expect(await b.queryJson(`SELECT "region" AS v FROM dataset WHERE __row_index__ = 2`)).toEqual([{ v: "south" }]);
  });

  test("saving with no fields removes a stale sidecar (deletions persist)", async () => {
    const path = sidecarPath("empty");

    const store = await createMockStore(5);
    activeStore = store;
    await store.registerAnnotationColumn("gone");
    await store.saveAnnotationsSidecar(path);
    expect(await Bun.file(path).exists()).toBe(true);

    await store.dropAnnotationColumn("gone");
    await store.saveAnnotationsSidecar(path);
    expect(await Bun.file(path).exists()).toBe(false);
  });

  test("converting label → text persists through the sidecar", async () => {
    const path = sidecarPath("dtype");

    const a = await createMockStore(8);
    await a.registerAnnotationColumn("notes");
    await a.writeAnnotationValues("notes", [{ rowIndex: 3, value: "free text" }]);
    const state = createServerSession({ store: a, annotationsSidecarPath: path });
    const response = await handlePatchAnnotationColumn("notes", post({ dtype: "text" }), state);
    expect(await response.json()).toEqual({ column: "notes", dtype: "text" });
    a.close();

    const b = await createMockStore(8);
    activeStore = b;
    await b.loadAnnotationsSidecar(path);
    expect(b.annotationColumns.get("notes")?.dtype).toBe("text");
    expect(await b.queryJson(`SELECT "notes" AS v FROM dataset WHERE __row_index__ = 3`)).toEqual([{ v: "free text" }]);
  });
});
