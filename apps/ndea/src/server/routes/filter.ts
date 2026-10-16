/**
 * POST /api/filter: run a typed filter clause against the `dataset` VIEW.
 *
 * The clause compiles through `filterClauseSql`, the same compiler workspace
 * data sources and filter scopes use, so this route and the dashboard select
 * the same observations.
 */

import { FilterRequestSchema, type FilterResponse } from "@ndea/protocol";
import { filterClauseSql } from "@ndea/components/filter";
import { PREDICATE_ERROR_RE, queryObservations } from "../observations.ts";
import { parseJsonBody } from "../protocol.ts";
import type { ServerSession } from "../state.ts";

export async function handleFilter(req: Request, state: Pick<ServerSession, "store" | "datasets">): Promise<Response> {
  const parsed = await parseJsonBody(req, FilterRequestSchema);
  if (!parsed.ok) return parsed.response;
  const sql = parsed.data.where ? filterClauseSql(parsed.data.where) : null;
  try {
    const response: FilterResponse = { sql, ...(await queryObservations(state, sql, parsed.data.limit)) };
    return Response.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message, sql }, { status: PREDICATE_ERROR_RE.test(message) ? 400 : 500 });
  }
}
