/**
 * HTTP route handler for Mosaic DuckDB queries.
 *
 * Wraps the existing handleMosaicQuery() and parseMosaicQuery() from mosaic.ts
 * as an HTTP route handler returning proper Response objects.
 *
 * Endpoint: POST /data/query, GET /data/query
 */

import type { DatasetQuerySession } from "../store.ts";
import { handleMosaicQuery, parseMosaicQuery } from "../mosaic.ts";

/**
 * Handle a Mosaic query HTTP request (GET or POST).
 *
 * GET uses ?query={json} query parameter.
 * POST uses JSON body.
 */
export async function handleMosaicRoute(req: Request, store: DatasetQuerySession): Promise<Response> {
  const parsed = await parseMosaicQuery(req);
  if (!parsed.ok) return parsed.response;
  return handleMosaicQuery(parsed.query, store);
}
