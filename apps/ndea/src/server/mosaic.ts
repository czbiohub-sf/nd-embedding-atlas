/**
 * Mosaic DuckDB query protocol handler.
 *
 * The Mosaic `restConnector` POSTs to `/data/query` with:
 *   { type: "arrow", sql: "SELECT ..." }
 *   { type: "exec",  sql: "CREATE TABLE mosaic.preagg_..." }
 * `json` remains for tests and curl.
 *
 * Ports Python `server/routes/_mosaic.py`.
 */

import { MosaicQueryBodySchema } from "@ndea/protocol";
import { parseJson } from "./request-body.ts";
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
 * go through `/api/categorize` and `/api/var-column`, which add columns through
 * `DatasetQuerySession` methods: they don't hit this path.
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

const ARROW_IPC_CONTENT_TYPE = "application/vnd.apache.arrow.stream";

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
    // No VIEW-rebuild hook needed: the allowlist admits no `ALTER TABLE`.
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
 * A Mosaic query from the JSON body (POST) or the `query` parameter (GET),
 * validated by `MosaicQueryBodySchema`, or a 400 problem response.
 */
export async function parseMosaicQuery(req: Request): Promise<MosaicQuery | Response> {
  const text = req.method === "GET" ? (new URL(req.url).searchParams.get("query") ?? "") : await req.text();
  return parseJson(text, MosaicQueryBodySchema);
}
