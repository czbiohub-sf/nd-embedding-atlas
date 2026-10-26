/**
 * obs_base, var_base and gene columns from AnnData / MuData stores, read by
 * DuckDB through the duckdb-zarr extension (`read_zarr`). One SQL path for a
 * single store, a multi-store union (`_dataset`), and MuData (`_modality`).
 *
 * Positions: `read_zarr`'s `obs`/`var` tables carry names, not positions. A
 * table's scan order is its store order (DuckDB preserves insertion order;
 * measured at 10M rows, 7 threads), so position = `row_number() OVER ()`, and
 * every ingest asserts it against the index array's own positions
 * (`array_path := '<axis>/_index'`), which costs one index read.
 */

import { AnnData, MuData, type DatasetHandle, type FrameMeta } from "@ndea/zarr";
import type { DuckDBConnection } from "@duckdb/node-api";
import { appendColumns } from "./append-columns.ts";
import { quoteIdent } from "@ndea/protocol";

/** One dataset of a project, in obs_base order. */
export interface IngestDataset {
  name: string;
  handle: DatasetHandle;
}

const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;

function sourceOf(handle: DatasetHandle): string {
  if (!handle.source) throw new Error("read_zarr needs a store path or URL; this dataset was opened in memory");
  return handle.source;
}

const readZarr = (source: string, args: string) => `read_zarr(${lit(source)}, ${args})`;

/** An index array's rows: `__pos` (its own positions) and `__name`. */
const indexRowsSql = (source: string, indexPath: string) =>
  `SELECT #1::INTEGER AS __pos, CAST(#2 AS VARCHAR) AS __name FROM ${readZarr(source, `array_path := ${lit(indexPath)}`)}`;

/** Rows of one frame: `__pos` (store position), `__name` (index), then its columns. */
interface FramePart {
  source: string;
  /** `_dataset` / `_modality` value, or null when the table has no tag column. */
  tag: string | null;
  sql: string;
  length: number;
  hasColumns: boolean;
  /** The frame's index array, for the position assertion. */
  indexPath: string;
}

/** An AnnData group's obs or var frame through `read_zarr`. */
function annDataFrame(
  source: string,
  groupPath: string,
  axis: "obs" | "var",
  meta: FrameMeta,
  tag: string | null,
): FramePart {
  const indexPath = `${groupPath ? `${groupPath}/` : ""}${axis}/${meta.indexName}`;
  const group = groupPath ? `group_path := ${lit(groupPath)}, ` : "";
  // A frame with no columns has no `read_zarr` table; its index array alone has the rows.
  const sql =
    meta.columns.length === 0
      ? indexRowsSql(source, indexPath)
      : `SELECT (row_number() OVER () - 1)::INTEGER AS __pos, CAST(${axis} AS VARCHAR) AS __name, * EXCLUDE (${axis}) ` +
        `FROM ${readZarr(source, `${group}table_name := ${lit(axis)}`)}`;
  return { source, tag, sql, length: meta.length, hasColumns: meta.columns.length > 0, indexPath };
}

/**
 * A MuData root frame. `read_zarr` doesn't decode frames outside AnnData
 * groups, so each column is decoded here from its raw arrays: categorical =
 * codes + categories, nullable = values + mask, else the plain array.
 */
function muDataRootFrame(source: string, axis: "obs" | "var", meta: FrameMeta, tag: string | null): FramePart {
  const raw = (path: string) => readZarr(source, `array_path := ${lit(`${axis}/${path}`)}`);
  const selects: string[] = [];
  const joins: string[] = [];
  for (const [i, name] of meta.columns.entries()) {
    const t = `c${i}`;
    selects.push(`${t}.v AS ${quoteIdent(name)}`);
    const encoding = meta.encodings[name];
    if (encoding === "categorical") {
      joins.push(
        `LEFT JOIN (SELECT k.dim_0 AS __pos, v.value AS v FROM ${raw(`${name}/codes`)} k LEFT JOIN ${raw(`${name}/categories`)} v ON v.dim_0 = k.value) ${t} ON ${t}.__pos = i.dim_0`,
      );
    } else if (encoding.startsWith("nullable-")) {
      joins.push(
        `LEFT JOIN (SELECT v.dim_0 AS __pos, CASE WHEN m.value THEN NULL ELSE v.value END AS v FROM ${raw(`${name}/values`)} v JOIN ${raw(`${name}/mask`)} m USING (dim_0)) ${t} ON ${t}.__pos = i.dim_0`,
      );
    } else {
      joins.push(`LEFT JOIN (SELECT dim_0 AS __pos, value AS v FROM ${raw(name)}) ${t} ON ${t}.__pos = i.dim_0`);
    }
  }
  const sql =
    `SELECT i.dim_0::INTEGER AS __pos, CAST(i.value AS VARCHAR) AS __name${selects.map((s) => `, ${s}`).join("")} ` +
    `FROM ${raw(meta.indexName)} i ${joins.join(" ")}`;
  return {
    source,
    tag,
    sql,
    length: meta.length,
    hasColumns: meta.columns.length > 0,
    indexPath: `${axis}/${meta.indexName}`,
  };
}

/** Throws unless two `(__pos, __name)` queries have the same rows. */
async function assertSameRows(conn: DuckDBConnection, what: string, expected: string, actual: string): Promise<void> {
  const [check] = (
    await conn.runAndReadAll(
      `SELECT count(*)::INTEGER AS bad FROM (${expected}) e FULL JOIN (${actual}) a USING (__pos) WHERE e.__name IS DISTINCT FROM a.__name`,
    )
  ).getRowObjectsJS();
  const bad = Number(check.bad);
  if (bad > 0) throw new Error(`${what}: ${bad} rows out of store order`);
}

/**
 * `CREATE TABLE <table> AS <select>` with every ENUM column (read_zarr's string
 * categoricals) stored as VARCHAR.
 * ponytail: nanoarrow's `to_arrow_ipc` (Mosaic's arrow path) can't encode
 * Arrow dictionaries and fails with a FATAL error that invalidates the whole
 * database, so ENUMs never reach a table; revisit when nanoarrow encodes them.
 */
async function createTable(conn: DuckDBConnection, table: string, select: string): Promise<void> {
  const [names, types] = (
    await conn.runAndReadAll(`SELECT column_name, column_type FROM (DESCRIBE ${select})`)
  ).getColumnsJS() as [string[], string[]];
  const columns = names.map((name, i) =>
    types[i].startsWith("ENUM(") ? `CAST(${quoteIdent(name)} AS VARCHAR) AS ${quoteIdent(name)}` : quoteIdent(name),
  );
  await conn.run(`CREATE TABLE ${table} AS SELECT ${columns.join(", ")} FROM (${select})`);
}

/**
 * `CREATE TABLE <table>`: the parts stacked in order (`UNION ALL BY NAME`, so
 * differing columns fill with NULL), `__<axis>_index__` global across parts,
 * `<axis>_name` and `_index` from the index, the tag column when given; obs
 * also gets `__row_index__`. Then each part's positions are asserted against
 * its index array.
 */
async function createAxisTable(
  conn: DuckDBConnection,
  table: string,
  axis: "obs" | "var",
  parts: readonly FramePart[],
  tagColumn: "_dataset" | "_modality" | null,
): Promise<void> {
  const offsets = parts.map((_, i) => parts.slice(0, i).reduce((n, p) => n + p.length, 0));
  const branches = parts.map((part, i) => {
    const tag = tagColumn ? `${lit(part.tag ?? "")} AS ${tagColumn}, ` : "";
    const rest = part.hasColumns ? ", * EXCLUDE (__pos, __name)" : "";
    return `SELECT (__pos + ${offsets[i]})::INTEGER AS __${axis}_index__, __name AS ${axis}_name, ${tag}__name AS _index${rest} FROM (${part.sql})`;
  });
  const stacked =
    branches.length > 1 ? `${branches.join(" UNION ALL BY NAME ")} ORDER BY __${axis}_index__` : branches[0];
  const rowIndex = axis === "obs" ? ", __obs_index__ AS __row_index__" : "";
  await createTable(conn, table, `SELECT *${rowIndex} FROM (${stacked})`);

  for (const [i, part] of parts.entries()) {
    const where = tagColumn ? `WHERE ${tagColumn} = ${lit(part.tag ?? "")}` : "";
    await assertSameRows(
      conn,
      `${table} (${part.indexPath})`,
      indexRowsSql(part.source, part.indexPath),
      `SELECT __${axis}_index__ - ${offsets[i]} AS __pos, ${axis}_name AS __name FROM ${table} ${where}`,
    );
  }
}

/** The single MuData of a project, or null for AnnData stores. */
function muDataOf(datasets: readonly IngestDataset[]): MuData | null {
  const handle = datasets[0]?.handle;
  return handle instanceof MuData ? handle : null;
}

/** `obs_base` for a project's datasets. */
export async function ingestObs(conn: DuckDBConnection, datasets: readonly IngestDataset[]): Promise<void> {
  const mu = muDataOf(datasets);
  if (mu) return ingestMuDataObs(conn, mu);
  const tagged = datasets.length > 1;
  const parts = datasets.map(({ name, handle }) =>
    annDataFrame(sourceOf(handle), "", "obs", handle.obs, tagged ? name : null),
  );
  await createAxisTable(conn, "obs_base", "obs", parts, tagged ? "_dataset" : null);
}

/** `var_base` for a project's datasets; MuData stacks the shared var and each modality's var. */
export async function ingestVar(conn: DuckDBConnection, datasets: readonly IngestDataset[]): Promise<void> {
  const mu = muDataOf(datasets);
  const parts: FramePart[] = [];
  if (mu) {
    const source = sourceOf(mu);
    if (mu.var.length > 0) parts.push(muDataRootFrame(source, "var", mu.var, "__shared__"));
    for (const [name, modality] of mu.mod) {
      if (modality.var.length > 0) parts.push(annDataFrame(source, modality.groupPath, "var", modality.var, name));
    }
  } else {
    for (const { name, handle } of datasets) {
      parts.push(annDataFrame(sourceOf(handle), "", "var", handle.var, datasets.length > 1 ? name : null));
    }
  }
  if (parts.length === 0) return;
  await createAxisTable(conn, "var_base", "var", parts, mu ? "_modality" : datasets.length > 1 ? "_dataset" : null);
}

/**
 * MuData obs: the root obs columns, then each modality's columns joined by
 * position (axis=0: every modality has the root's obs, in order). A modality
 * column that collides with an earlier name becomes `<mod>:<col>`, the
 * scverse `get_obs_mudata` convention.
 */
async function ingestMuDataObs(conn: DuckDBConnection, mu: MuData): Promise<void> {
  const source = sourceOf(mu);
  const modalities = [...mu.mod].map(([name, modality]) => ({
    name,
    part: annDataFrame(source, modality.groupPath, "obs", modality.obs, null),
  }));
  const root = mu.obs.length > 0 ? muDataRootFrame(source, "obs", mu.obs, null) : modalities[0]?.part;
  if (!root) throw new Error("MuData has neither a root obs nor a modality");

  const seen = new Set(["__obs_index__", "obs_name", "_index", "__row_index__", ...mu.obs.columns]);
  const selects = mu.obs.columns.map((c) => `r.${quoteIdent(c)}`);
  const joins: string[] = [];
  for (const [i, { name, part }] of modalities.entries()) {
    if (!part.hasColumns) continue;
    const columns = (
      await conn.runAndReadAll(`SELECT column_name FROM (DESCRIBE ${part.sql})`)
    ).getColumnsJS()[0] as string[];
    for (const column of columns.filter((c) => c !== "__pos" && c !== "__name")) {
      const key = seen.has(column) ? `${name}:${column}` : column;
      seen.add(key);
      selects.push(`m${i}.${quoteIdent(column)} AS ${quoteIdent(key)}`);
    }
    joins.push(`LEFT JOIN (${part.sql}) m${i} ON m${i}.__pos = r.__pos`);
  }
  await createTable(
    conn,
    "obs_base",
    `SELECT r.__pos AS __obs_index__, r.__name AS obs_name, r.__name AS _index` +
      `${selects.map((s) => `, ${s}`).join("")}, r.__pos AS __row_index__ FROM (${root.sql}) r ${joins.join(" ")} ORDER BY r.__pos`,
  );

  // The root in store order, and axis=0: each modality's obs is the root's, in order.
  const rows = "SELECT __obs_index__ AS __pos, obs_name AS __name FROM obs_base";
  await assertSameRows(conn, `obs_base (${root.indexPath})`, indexRowsSql(root.source, root.indexPath), rows);
  for (const { name, part } of modalities) {
    await assertSameRows(
      conn,
      `MuData modality "${name}" obs vs the root obs (axis=0)`,
      rows,
      `SELECT __pos, __name FROM (${part.sql})`,
    );
  }
}

// ─── Gene (var) columns ─────────────────────────────────────────────────────

export interface VarColumnRequest {
  name: string;
  /** "X" or a layer name. */
  layer: string;
  /** MuData modality holding the var; required for MuData. */
  modality?: string;
}

/** Numbers the scratch tables of dense var columns, so concurrent requests never share one. */
let denseColumns = 0;

/**
 * A query of `(__row_index__, value)` for one var across the project's
 * datasets, in obs_base row order. A sparse matrix reads through `read_zarr`
 * (unstored entries are 0); NaN/±Inf and datasets without the var are NULL.
 * A dense matrix's column is read in JS into a scratch table the caller
 * drops (`scratch`) once the query has run.
 */
export async function varColumnQuery(
  conn: DuckDBConnection,
  datasets: readonly IngestDataset[],
  request: VarColumnRequest,
): Promise<{ query: string; scratch: string[] }> {
  const mu = muDataOf(datasets);
  const members: { adata: AnnData; obsOffset: number; varOffset: number; varWhere: string }[] = [];
  if (mu) {
    if (!request.modality) throw new Error("MuData var columns need a modality");
    const adata = mu.mod.get(request.modality);
    if (!adata) throw new Error(`Unknown modality "${request.modality}"`);
    let varOffset = mu.var.length;
    for (const [name, modality] of mu.mod) {
      if (name === request.modality) break;
      varOffset += modality.var.length;
    }
    members.push({ adata, obsOffset: 0, varOffset, varWhere: `_modality = ${lit(request.modality)}` });
  } else {
    let obsOffset = 0;
    let varOffset = 0;
    for (const { name, handle } of datasets) {
      if (!(handle instanceof AnnData)) throw new Error(`${name}: not an AnnData store`);
      members.push({
        adata: handle,
        obsOffset,
        varOffset,
        varWhere: datasets.length > 1 ? `_dataset = ${lit(name)}` : "TRUE",
      });
      obsOffset += handle.nObs;
      varOffset += handle.nVars;
    }
  }

  const path = request.layer === "X" ? "X" : `layers/${request.layer}`;
  const parts: string[] = [];
  const present: string[] = [];
  const scratch: string[] = [];
  for (const { adata, obsOffset, varOffset, varWhere } of members) {
    const found = (
      await conn.runAndReadAll(
        `SELECT __var_index__ - ${varOffset} AS j FROM var_base WHERE ${varWhere} AND var_name = $name LIMIT 1`,
        {
          name: request.name,
        },
      )
    ).getRowObjectsJS()[0];
    if (!found) continue;
    const j = Number(found.j);
    const format = await adata.matrixFormat(path);
    if (format === null) throw new Error(`${path} not found`);
    present.push(`b.__row_index__ BETWEEN ${obsOffset} AND ${obsOffset + adata.nObs - 1}`);
    if (format === "dense") {
      // ponytail: a dense matrix's column is read in JS; read_zarr has no filter pushdown until duckdb-zarr v0.3.
      const values = await adata.readDenseColumn(path, j);
      const table = `__dense_var_${++denseColumns}`;
      scratch.push(table);
      const rows = Int32Array.from({ length: values.length }, (_, i) => obsOffset + i);
      await appendColumns(
        conn,
        table,
        values.length,
        [
          { name: "r", type: "INTEGER", values: rows },
          { name: "v", type: "DOUBLE", values },
        ],
        { create: true },
      );
      parts.push(`SELECT r, v FROM ${table}`);
    } else {
      const arrayPath = adata.groupPath ? `${adata.groupPath}/${path}` : path;
      // Entries are (obs, var, value); the value column is named after the array at the root, so read by position.
      const entries = `SELECT #1 AS i, #2 AS j, #3 AS v FROM ${readZarr(sourceOf(adata), `array_path := ${lit(arrayPath)}`)}`;
      parts.push(`SELECT (i + ${obsOffset})::INTEGER AS r, v::DOUBLE AS v FROM (${entries}) WHERE j = ${j}`);
    }
  }
  if (present.length === 0) throw new Error(`var "${request.name}" not found`);
  const query =
    `SELECT b.__row_index__, CASE WHEN (${present.join(" OR ")}) AND isfinite(coalesce(s.v, 0)) THEN coalesce(s.v, 0) END AS value ` +
    `FROM obs_base b LEFT JOIN (${parts.join(" UNION ALL ")}) s ON s.r = b.__row_index__`;
  return { query, scratch };
}
