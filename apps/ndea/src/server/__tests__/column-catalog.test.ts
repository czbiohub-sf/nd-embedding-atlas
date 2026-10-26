import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProblemSchema } from "@ndea/protocol";
import { handleCategorize } from "../routes/categorize.ts";
import { handleColumns } from "../routes/columns.ts";
import { handleScatterCategories, handleScatterContinuousValues } from "../routes/scatter.ts";
import { handleWorkspacePatch } from "../routes/workspace.ts";
import { createServerSession } from "../state.ts";
import { DatasetQuerySession } from "../store.ts";

const EVIL = 'x" ; DROP TABLE obs_base; --';

let dir: string | null = null;
let store: DatasetQuerySession | null = null;
afterEach(async () => {
  store?.close();
  store = null;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

async function session() {
  dir = await mkdtemp(join(tmpdir(), "ndea-columns-"));
  store = await DatasetQuerySession.fromInit(async (conn) => {
    await conn.run(`CREATE TABLE obs_base AS SELECT * FROM (VALUES
      (0, 'a', 'infected', 10.0),
      (1, 'b', 'mock', 50.0),
      (2, 'c', 'infected', 90.0)
    ) AS t(__row_index__, obs_name, condition, area)`);
  });
  return createServerSession({ store, observationSetsDirectory: join(dir, "sets") });
}

async function obsRows(): Promise<number> {
  const [row] = await store!.queryJson("SELECT count(*)::INT AS n FROM obs_base");
  return Number(row.n);
}

test("request-supplied column names resolve against the catalog; injection gets 400 and the table survives", async () => {
  await session();
  const categorize = (column: string) =>
    handleCategorize(
      new Request("http://x/api/categorize", { method: "POST", body: JSON.stringify({ column }) }),
      store!,
    );

  const rejected = await categorize(EVIL);
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toEqual({ error: `Unknown column "${EVIL}"` });
  const evilColor = new URL(`http://x/?color_col=${encodeURIComponent(EVIL)}`);
  expect((await handleScatterContinuousValues(evilColor, store!)).status).toBe(400);
  for (const query of [
    `cat_col=${encodeURIComponent(EVIL)}`,
    `cat_col=condition&original_col=${encodeURIComponent(EVIL)}`,
  ]) {
    expect((await handleScatterCategories(new URL(`http://x/?${query}`), store!)).status).toBe(400);
  }
  expect(await obsRows()).toBe(3);

  const accepted = await categorize("condition");
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toMatchObject({
    indexColumn: "__ev_condition_id",
    legend: [
      { label: "infected", count: 2 },
      { label: "mock", count: 1 },
    ],
  });
  expect(store!.columns().get("__ev_condition_id")).toEqual({ sqlType: "INTEGER", kind: "obs" });
});

test("GET /api/columns lists the catalog with types and kinds, internal columns excluded, after every rebuild", async () => {
  await session();
  const catalog = async () => (await handleColumns(store!).json()) as unknown[];
  expect(await catalog()).toEqual([
    { name: "obs_name", type: "string", sqlType: "VARCHAR", kind: "obs" },
    { name: "condition", type: "string", sqlType: "VARCHAR", kind: "obs" },
    { name: "area", type: "number", sqlType: "DECIMAL(3,1)", kind: "obs" },
  ]);
  await store!.registerAnnotationColumn("note", "text");
  await store!.addObsIndexColumn("__ev_condition_id");
  expect(await catalog()).toContainEqual({ name: "note", type: "string", sqlType: "VARCHAR", kind: "annotation" });
  expect((await catalog()).length).toBe(4);
});

test("PATCH rejects typed clauses on unknown columns with pointers and accepts known ones", async () => {
  const state = await session();
  const patch = (baseRevision: number, ops: unknown[]) =>
    handleWorkspacePatch(
      new Request("http://x/api/workspace", { method: "PATCH", body: JSON.stringify({ baseRevision, ops }) }),
      state,
    );

  const rejected = await patch(0, [
    { op: "add", path: "/data/bad", value: { where: { op: "not", clause: { op: "eq", column: "nope", value: 1 } } } },
    {
      op: "add",
      path: "/state/filter",
      value: { A: { "agent/x": { area: { op: "gt", column: "missing", value: 1 } } } },
    },
  ]);
  expect(rejected.status).toBe(400);
  expect(ProblemSchema.parse(await rejected.json()).errors).toEqual([
    { pointer: "/data/bad/where/clause/column", detail: 'unknown column "nope"' },
    { pointer: "/state/filter/A/agent~1x/area/column", detail: 'unknown column "missing"' },
  ]);
  expect(state.workspace.get().revision).toBe(0);

  const accepted = await patch(0, [
    { op: "add", path: "/data/infected", value: { where: { op: "eq", column: "condition", value: "infected" } } },
    { op: "add", path: "/state/filter", value: { A: { agent: { area: { op: "gt", column: "area", value: 20 } } } } },
  ]);
  expect(accepted.status).toBe(200);
  expect(state.workspace.get().revision).toBe(1);
});
