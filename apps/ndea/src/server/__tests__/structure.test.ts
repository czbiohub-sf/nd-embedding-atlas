import { afterEach, expect, test } from "bun:test";
import type { Server } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatasetQuerySession } from "../store.ts";
import { createApp } from "../app.ts";
import type { DatasetSessionMetadata } from "../state.ts";
import { createServerSession } from "../state.ts";
import { datasetStructure } from "../structure.ts";
import type { ServerSocketContext } from "../ws.ts";

let dir = "";
let server: Server<ServerSocketContext> | null = null;
afterEach(async () => {
  void server?.stop(true);
  await rm(dir, { recursive: true, force: true });
});

const array = (shape: number[], dtype = "<f4") => ({
  zarr_format: 2,
  shape,
  chunks: shape,
  dtype,
  compressor: null,
  fill_value: 0,
  order: "C",
  filters: null,
});

/** Metadata-only zarr v2 files (no chunks): the structure reader never touches array data. */
async function write(files: Record<string, unknown>): Promise<void> {
  await Promise.all(Object.entries(files).map(([path, json]) => Bun.write(join(dir, path), JSON.stringify(json))));
}

test("datasetStructure reads AnnData and plate metadata; the route needs the token and a known dataset", async () => {
  dir = await mkdtemp(join(tmpdir(), "ndea-structure-"));
  const group = { zarr_format: 2 };
  await write({
    "a.zarr/.zgroup": group,
    "a.zarr/X/.zarray": array([4, 3]),
    "a.zarr/obs/.zgroup": group,
    "a.zarr/obs/.zattrs": { _index: "_index", "column-order": ["t", "cell"], "encoding-type": "dataframe" },
    "a.zarr/obs/_index/.zarray": array([4], "<i8"),
    "a.zarr/obs/t/.zarray": array([4], "<i8"),
    "a.zarr/obs/cell/.zgroup": group,
    "a.zarr/obs/cell/.zattrs": { "encoding-type": "categorical" },
    "a.zarr/obsm/.zgroup": group,
    "a.zarr/obsm/X_umap/.zarray": array([4, 2]),
    "p.zarr/.zgroup": group,
    "p.zarr/.zattrs": {
      plate: { rows: [{ name: "A" }], columns: [{ name: "1" }, { name: "2" }], wells: [{ path: "A/2" }] },
    },
    "p.zarr/A/2/.zgroup": group,
    "p.zarr/A/2/.zattrs": { well: { images: [{ path: "0" }, { path: "1" }] } },
    "p.zarr/A/2/0/.zgroup": group,
    "p.zarr/A/2/0/.zattrs": {
      multiscales: [{ axes: ["t", "c", "z", "y", "x"].map((name) => ({ name })), datasets: [{ path: "0" }] }],
    },
    "p.zarr/A/2/0/0/.zarray": array([1, 2, 1, 8, 8], "<u2"),
  });
  const store = await DatasetQuerySession.fromInit(async (conn) => {
    await conn.run("CREATE TABLE obs_base AS SELECT 0 AS __row_index__");
  });
  const state = createServerSession({ store, datasets: new Map([["a", { path: join(dir, "a.zarr") }]]) });
  const channels = [{ name: "DAPI", color: "#0000FF" }];
  state.status.datasets = [
    {
      name: "a",
      format: "anndata",
      path: join(dir, "a.zarr"),
      observations: 4,
      variables: 3,
      obsColumns: 2,
      embeddings: ["X_umap"],
      plate: { path: join(dir, "p.zarr"), wells: 1, channels },
    },
  ];

  const structure = await datasetStructure(state, "a");
  expect(structure.anndata.X).toEqual({ shape: [4, 3], dtype: "float32" });
  expect(structure.anndata.obs).toEqual({
    count: 4,
    columns: [
      { name: "t", dtype: "int64" },
      { name: "cell", dtype: "categorical" },
    ],
  });
  expect(structure.anndata.obsm).toEqual([{ key: "X_umap", shape: [4, 2] }]);
  expect(structure.anndata.layers).toEqual([]);
  expect(structure.plate).toEqual({
    rows: ["A"],
    columns: ["1", "2"],
    wells: [{ row: 0, col: 1, fovs: 2 }],
    channels,
    image: { axes: "TCZYX", shape: [1, 2, 1, 8, 8], dtype: "uint16" },
  });
  expect(await datasetStructure(state, "a")).toBe(structure);

  server = createApp({
    port: 0,
    host: "localhost",
    store,
    state,
    config: {} as DatasetSessionMetadata,
    noStatic: true,
    mcpToken: "secret",
  });
  const url = (name: string) => `http://localhost:${server!.port}/api/status/datasets/${name}/structure`;
  const auth = { headers: { authorization: "Bearer secret" } };
  expect((await fetch(url("a"))).status).toBe(401);
  expect((await fetch(url("nope"), auth)).status).toBe(404);
  expect(await (await fetch(url("a"), auth)).json()).toEqual(structure);
  store.close();
});
