/**
 * HTTP route handler for Mosaic DuckDB queries.
 *
 * Wraps the existing handleMosaicQuery() and parseMosaicQuery() from mosaic.ts
 * as an HTTP route handler returning proper Response objects.
 *
 * Endpoint: POST /data/query, GET /data/query
 */

import type { EmbeddingStore } from "../store.ts";
import { handleMosaicQuery, parseMosaicQuery } from "../mosaic.ts";

/**
 * Handle a Mosaic query HTTP request (GET or POST).
 *
 * GET uses ?query={json} query parameter.
 * POST uses JSON body.
 */
export async function handleMosaicRoute(req: Request, store: EmbeddingStore): Promise<Response> {
    const query = await parseMosaicQuery(req);

    if (!query) {
        return Response.json(
            { error: "Missing or invalid query payload. Expected { type, sql }." },
            { status: 400 },
        );
    }

    return handleMosaicQuery(query, store);
}
