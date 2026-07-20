/**
 * Mosaic DuckDB query protocol handler.
 *
 * The Mosaic frontend sends POST/GET requests to `/data/query` with:
 *   { type: "arrow", sql: "SELECT ..." }
 *   { type: "exec",  sql: "CREATE TABLE mosaic.preagg_..." }
 *   { type: "json",  sql: "SELECT DISTINCT ..." }
 *
 * Ports Python `server/routes/_mosaic.py`.
 */

import { MosaicQueryBodySchema } from "./protocol.ts";
import type { DatasetQuerySession } from "./store.ts";

// ─── SQL Security Filter ─────────────────────────────────────────────────────

/**
 * Mutations the frontend legitimately needs.
 * Checked first: if any matches, the statement is allowed.
 */
/**
 * Mosaic coordinator + preaggregator emit CREATE SCHEMA / CREATE TABLE /
 * DROP TABLE IF EXISTS / DROP SCHEMA (for `mosaic.preagg_*` materializations).
 * Those are the ONLY legitimate mutations flowing through `/data/query`.
 *
 * Frontend-driven schema changes (categorical index columns, var materialization)
 * now go through dedicated REST endpoints (`/api/categorize`, `/api/var-column`)
 * that use `store.execute()` directly: they don't hit this path.
 */
const ALLOWED_MUTATIONS: readonly string[] = ["CREATE SCHEMA", "CREATE TABLE", "DROP TABLE IF EXISTS", "DROP SCHEMA"];

/**
 * Everything else that mutates state is blocked.
 * Checked second: if any matches AND no allowed mutation matched, the query is rejected.
 */
const BLOCKED_PREFIXES: readonly string[] = [
  "DROP",
  "DELETE",
  "INSERT",
  "UPDATE",
  "CREATE",
  "ALTER",
  "COPY",
  "ATTACH",
  "DETACH",
  "EXPORT",
  "IMPORT",
];

/** Returns true if the SQL statement is allowed, false if it should be blocked. */
export function isAllowedSql(sql: string): boolean {
  const stripped = sql.trim().toUpperCase();

  // Check if it matches any allowed mutation first
  const isAllowedMutation = ALLOWED_MUTATIONS.some((prefix) => stripped.startsWith(prefix));
  if (isAllowedMutation) return true;

  // Check if it matches any blocked prefix
  const isBlocked = BLOCKED_PREFIXES.some((prefix) => stripped.startsWith(prefix));
  if (isBlocked) return false;

  // SELECT and other read-only statements are allowed
  return true;
}

// ─── Mosaic Query Types ──────────────────────────────────────────────────────

export interface MosaicQuery {
  type: string;
  sql: string;
}

// ─── Content types ───────────────────────────────────────────────────────────

export const ARROW_IPC_CONTENT_TYPE = "application/vnd.apache.arrow.stream";

// ─── Query Handler ───────────────────────────────────────────────────────────

/**
 * Handle a Mosaic query against the analytical dataset query session.
 *
 * @returns A Response object with the appropriate content type.
 */
export async function handleMosaicQuery(body: MosaicQuery, store: DatasetQuerySession): Promise<Response> {
  if (!body.sql || !body.type) {
    return Response.json({ error: "Missing 'sql' or 'type' in query payload" }, { status: 400 });
  }

  const { sql, type: command } = body;

  // SQL security filter
  if (!isAllowedSql(sql)) {
    return Response.json({ error: "Statement type not allowed" }, { status: 400 });
  }

  try {
    // No VIEW-rebuild hook needed: ALTER TABLE obs_base ADD COLUMN now flows
    // through /api/categorize and /api/var-column, both of which rebuild the
    // VIEW explicitly.
    if (command === "exec") {
      await store.execute(sql);
      return Response.json({});
    }

    if (command === "arrow") {
      const ipcBytes = await store.queryArrow(sql);
      return new Response(ipcBytes as unknown as BodyInit, {
        headers: { "Content-Type": ARROW_IPC_CONTENT_TYPE },
      });
    }

    if (command === "json") {
      const rows = await store.queryJson(sql);
      return Response.json(rows);
    }

    return Response.json({ error: `Unknown command: ${command}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let schemaSummary = "<n/a>";
    try {
      const rows = await store.queryJson("SELECT column_name FROM (DESCRIBE dataset)");
      schemaSummary = rows.map((r) => r["column_name"]).join(", ");
    } catch {
      /* ignore */
    }
    console.error(`[mosaic] ${command} failed: ${message}\n  SQL: ${sql}\n  dataset cols: ${schemaSummary}`);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * Parse a Mosaic query from a Request object.
 *
 * Handles both GET (query string) and POST (JSON body) patterns.
 * Validates the payload against MosaicQueryBodySchema (discriminated
 * union on `type`) and returns a 400 Response on validation failure.
 */
export async function parseMosaicQuery(
  req: Request,
): Promise<{ ok: true; query: MosaicQuery } | { ok: false; response: Response }> {
  let raw: unknown;
  if (req.method === "GET") {
    const url = new URL(req.url);
    const queryParam = url.searchParams.get("query");
    if (!queryParam) {
      return {
        ok: false,
        response: Response.json({ error: "Missing 'query' parameter" }, { status: 400 }),
      };
    }
    try {
      raw = JSON.parse(queryParam);
    } catch {
      return {
        ok: false,
        response: Response.json({ error: "Invalid JSON in 'query' parameter" }, { status: 400 }),
      };
    }
  } else {
    // POST
    try {
      raw = await req.json();
    } catch {
      return {
        ok: false,
        response: Response.json({ error: "Invalid JSON body" }, { status: 400 }),
      };
    }
  }

  const result = MosaicQueryBodySchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: Response.json(
        { error: "Query payload failed validation", issues: result.error.issues },
        { status: 400 },
      ),
    };
  }
  return { ok: true, query: result.data };
}
