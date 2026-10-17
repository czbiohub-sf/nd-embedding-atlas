/**
 * Experimental: the AnnData layout and plate grid behind the status screen's
 * structure view (`cli/tui-structure.ts` lists the removal steps). Reads zarr
 * metadata only, never array data; built on first request, cached per dataset.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import FileSystemStore from "@zarrita/storage/fs";
import * as zarr from "zarrita";
import { DatasetStructureSchema } from "@ndea/protocol";
import type { DatasetStructure, RuntimeStatus } from "@ndea/protocol";
import { hasBearer } from "./mcp-token.ts";
import type { ServerSession } from "./state.ts";

type Attrs = Record<string, unknown>;

const cache = new WeakMap<RuntimeStatus["datasets"][number], Promise<DatasetStructure>>();

/** Child names of a local zarr group; [] when it is missing. */
const ls = (dir: string): Promise<string[]> =>
  readdir(dir).then(
    (names) => names.filter((name) => !name.startsWith(".") && name !== "zarr.json").toSorted(),
    () => [],
  );

/** A node opener for one store; null when the path is missing or unreadable. */
function opener(dir: string) {
  const root = zarr.root(new FileSystemStore(dir));
  return (path: string) => zarr.open(root.resolve(path)).catch(() => null);
}

async function readAnnData(dir: string): Promise<DatasetStructure["anndata"]> {
  const open = opener(dir);
  /** Arrays report shape/dtype; sparse groups their `shape` attr and `data` dtype; other groups their encoding. */
  const info = async (path: string) => {
    const node = await open(path);
    if (node?.kind === "array") return { shape: [...node.shape], dtype: node.dtype as string };
    const attrs = node?.attrs ?? {};
    const data = node && (await open(`${path}/data`));
    const dtype = data?.kind === "array" ? data.dtype : ((attrs["encoding-type"] as string | undefined) ?? "?");
    return { shape: (attrs.shape as number[] | undefined) ?? [], dtype };
  };
  const keyed = async (group: string) =>
    Promise.all(
      (await ls(join(dir, group))).map(async (key) => ({ key, shape: (await info(`${group}/${key}`)).shape })),
    );
  const frame = async (group: string) => {
    const attrs = (await open(group))?.attrs ?? {};
    const order = (attrs["column-order"] as string[] | undefined) ?? [];
    const [index, columns] = await Promise.all([
      info(`${group}/${(attrs._index as string | undefined) ?? "_index"}`),
      Promise.all(order.map(async (name) => ({ name, dtype: (await info(`${group}/${name}`)).dtype }))),
    ]);
    return { count: index.shape[0] ?? 0, columns };
  };
  const [X, obs, vars, obsm, varm, obsp, varp, layers, uns] = await Promise.all([
    info("X"),
    frame("obs"),
    frame("var"),
    keyed("obsm"),
    keyed("varm"),
    keyed("obsp"),
    keyed("varp"),
    keyed("layers"),
    ls(join(dir, "uns")),
  ]);
  return { X: X.shape.length ? X : null, obs, var: vars, obsm, varm, obsp, varp, layers, uns: uns.length };
}

async function readPlate(dir: string) {
  const open = opener(dir);
  // OME-Zarr 0.5 (zarr v3) nests its attributes under `ome`.
  const attrs = async (path: string) => {
    const a = (await open(path))?.attrs ?? {};
    return (a.ome ?? a) as Attrs;
  };
  const plate = (await attrs("/")).plate as {
    rows?: { name: string }[];
    columns?: { name: string }[];
    wells?: { path: string }[];
  };
  const rows = (plate?.rows ?? []).map((r) => r.name);
  const columns = (plate?.columns ?? []).map((c) => c.name);
  // One well-metadata read per well, in parallel.
  const wells = await Promise.all(
    (plate?.wells ?? []).map(async ({ path }) => {
      const [row, col] = path.split("/");
      const images = ((await attrs(path)).well as { images?: { path: string }[] } | undefined)?.images ?? [];
      return { row: rows.indexOf(row), col: columns.indexOf(col), fovs: images.length, first: images[0]?.path, path };
    }),
  );
  const well = wells.find((w) => w.first);
  let image = null;
  if (well) {
    const fov = `${well.path}/${well.first}`;
    const ms = ((await attrs(fov)).multiscales as { axes?: { name: string }[]; datasets?: { path: string }[] }[])?.[0];
    const array = await open(`${fov}/${ms?.datasets?.[0]?.path ?? "0"}`);
    if (array?.kind === "array") {
      const axes = (ms?.axes ?? []).map((a) => a.name.toUpperCase()).join("") || "TCZYX";
      image = { axes, shape: [...array.shape], dtype: array.dtype };
    }
  }
  return {
    rows,
    columns,
    wells: wells.filter((w) => w.row >= 0 && w.col >= 0).map(({ row, col, fovs }) => ({ row, col, fovs })),
    image,
  };
}

async function build(d: RuntimeStatus["datasets"][number]): Promise<DatasetStructure> {
  const modality = d.format === "mudata" ? (await ls(join(d.path, "mod")))[0] : undefined;
  const [anndata, plate] = await Promise.all([
    readAnnData(modality ? join(d.path, "mod", modality) : d.path),
    d.plate && readPlate(d.plate.path),
  ]);
  return DatasetStructureSchema.parse({
    name: d.name,
    modality,
    anndata,
    plate: d.plate && plate && { ...plate, channels: d.plate.channels },
  });
}

/** The named dataset's structure; computed once, retried after a failure. Throws for an unknown name. */
export function datasetStructure(session: ServerSession, name: string): Promise<DatasetStructure> {
  const d = session.status.datasets.find((dataset) => dataset.name === name);
  if (!d) return Promise.reject(new Error(`Unknown dataset: ${name}`));
  let structure = cache.get(d);
  if (!structure) {
    structure = build(d);
    cache.set(d, structure);
    structure.catch(() => cache.delete(d));
  }
  return structure;
}

/** GET /api/status/datasets/:name/structure: like `/api/status`, it takes the MCP bearer token. */
export async function handleStructure(req: Request, session: ServerSession, name: string, token?: string) {
  if (!token || !hasBearer(req, token))
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  if (!session.status.datasets.some((d) => d.name === name))
    return Response.json({ error: `Unknown dataset: ${name}` }, { status: 404 });
  return Response.json(await datasetStructure(session, name));
}
