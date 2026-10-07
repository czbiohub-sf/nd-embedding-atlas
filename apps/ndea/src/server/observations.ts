/**
 * Bounded observation lookup for a predicate: exact count plus the first
 * `limit` identities, ordered by row index. Shared by every route that
 * answers "which observations does this predicate select?".
 */

import type { FilterRow } from "@ndea/protocol";
import type { ServerSession } from "./state.ts";

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
  const multi = await state.store.hasDatasetColumn();
  const singleKey = state.datasets.keys().next().value ?? "";
  // Single prepared statements: `sql` may come from a workspace document.
  const [countRows, rows] = await Promise.all([
    state.store.querySingleJson(`SELECT count(*)::INT AS n FROM dataset${where}`),
    state.store.querySingleJson(
      `SELECT __row_index__, obs_name${multi ? ", _dataset" : ""} FROM dataset${where} ` +
        `ORDER BY __row_index__ LIMIT ${limit}`,
    ),
  ]);
  const count = Number(countRows[0]?.n ?? 0);
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
