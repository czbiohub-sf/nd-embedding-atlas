/**
 * POST /api/filter: run a typed filter clause against the `dataset` VIEW.
 *
 * The clause compiles through `filterClauseSql`, the same compiler the
 * browser `filter` node uses, so this route and the Workspace select the
 * same observations.
 */

import { FilterRequestSchema, type FilterResponse } from "@ndea/protocol";
import { filterClauseSql } from "@ndea/nodes/filter";
import { parseJsonBody } from "../protocol.ts";
import type { ServerSession } from "../state.ts";

/** DuckDB errors caused by the clause itself (unknown column, bad cast). */
const CLAUSE_ERROR_RE = /^(Binder|Conversion) Error/;

export async function handleFilter(req: Request, state: Pick<ServerSession, "store" | "datasets">): Promise<Response> {
  const parsed = await parseJsonBody(req, FilterRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { where, limit } = parsed.data;

  const sql = where ? filterClauseSql(where) : null;
  const whereSql = sql ? ` WHERE ${sql}` : "";
  const multi = await state.store.hasDatasetColumn();
  const singleKey = state.datasets.keys().next().value ?? "";

  try {
    const [countRows, rows] = await Promise.all([
      state.store.queryJson(`SELECT count(*)::INT AS n FROM dataset${whereSql}`),
      state.store.queryJson(
        `SELECT __row_index__, obs_name${multi ? ", _dataset" : ""} FROM dataset${whereSql} ` +
          `ORDER BY __row_index__ LIMIT ${limit}`,
      ),
    ]);
    const count = Number(countRows[0]?.n ?? 0);
    const response: FilterResponse = {
      sql,
      count,
      rows: rows.map((row) => ({
        rowIndex: Number(row.__row_index__),
        datasetKey: multi ? String(row._dataset) : singleKey,
        obsName: String(row.obs_name),
      })),
      truncated: count > rows.length,
    };
    return Response.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message, sql }, { status: CLAUSE_ERROR_RE.test(message) ? 400 : 500 });
  }
}
