/**
 * Observation predicates execute only as prepared single statements.
 * Owns bounded lookup, counts, annotation stamps, and file exports.
 */

import type { FilterRow } from "@ndea/protocol";
import type { ServerSession } from "./state.ts";
import { annValueLiteral, quoteIdent, type DatasetQuerySession } from "./store.ts";

export interface ObservationPage {
  count: number;
  rows: FilterRow[];
  truncated: boolean;
}

/** DuckDB errors caused by the predicate itself (unknown column, bad cast, syntax). */
export const PREDICATE_ERROR_RE = /^(Binder|Conversion|Parser|Invalid Input) Error/;

/** `sql: null` selects every observation. Throws DuckDB's error for an invalid predicate. */
export async function queryObservations(
  state: Pick<ServerSession, "store" | "datasets">,
  sql: string | null,
  limit: number,
): Promise<ObservationPage> {
  const where = sql ? ` WHERE (${sql})` : "";
  const multi = state.store.hasDatasetColumn();
  const singleKey = state.datasets.keys().next().value ?? "";
  // Single prepared statements: `sql` may come from a workspace document.
  const [count, rows] = await Promise.all([
    countObservations(state.store, sql),
    state.store.querySingleJson(
      `SELECT __row_index__, obs_name${multi ? ", _dataset" : ""} FROM dataset${where} ` +
        `ORDER BY __row_index__ LIMIT ${limit}`,
    ),
  ]);
  return {
    count,
    rows: rows.map((row) => ({
      rowIndex: Number(row.__row_index__),
      datasetKey: multi ? String(row._dataset) : singleKey,
      obsName: String(row.obs_name),
    })),
    truncated: count > rows.length,
  };
}

/** Exact population count. Invalid or stacked predicates never execute. */
export async function countObservations(store: DatasetQuerySession, predicate: string | null): Promise<number> {
  const where = predicate ? ` WHERE (${predicate})` : "";
  const rows = await store.querySingleJson(`SELECT count(*) AS n FROM dataset${where}`);
  return Number(rows[0]?.n ?? 0);
}

/** Stamp matching identities and return the population count before the write. */
export async function annotateObservations(
  store: DatasetQuerySession,
  column: string,
  value: string | null,
  predicate: string,
): Promise<number> {
  const entry = store.annotationColumns.get(column);
  if (!entry) throw new Error(`Unknown annotation column: ${column}`);
  const datasetKey = store.hasDatasetColumn() ? "ds._dataset" : "''";
  const literal = annValueLiteral(value, entry.dtype);
  const count = await countObservations(store, predicate);
  await store.executeSingle(
    `INSERT OR REPLACE INTO ${entry.table} (__row_index__, dataset_key, obs_name, ${quoteIdent(column)}) ` +
      `SELECT ds.__row_index__, ${datasetKey}, ds.obs_name, ${literal} FROM dataset ds WHERE (${predicate})`,
  );
  return count;
}

/** Export matching observations, optionally projecting annotation columns, as one prepared COPY. */
export async function exportObservations(
  store: DatasetQuerySession,
  predicate: string | null,
  outputPath: string,
  format: "parquet" | "csv" = "parquet",
  columns?: string[],
): Promise<void> {
  const where = predicate ? ` WHERE (${predicate})` : "";
  let projection = "*";
  if (columns) {
    const identities = store.hasDatasetColumn() ? "obs_name, _dataset" : "obs_name";
    projection = `${identities}, ${columns.map((column) => `CAST(${quoteIdent(column)} AS TEXT) AS ${quoteIdent(column)}`).join(", ")}`;
  }
  const escaped = outputPath.replaceAll("'", "''");
  await store.executeSingle(`COPY (SELECT ${projection} FROM dataset${where}) TO '${escaped}' (FORMAT ${format})`);
}
