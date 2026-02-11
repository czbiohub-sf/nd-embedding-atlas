/**
 * Shared Mosaic SQL utilities for chart components.
 */

import type { Coordinator } from "@uwdata/mosaic-core";
import { and, type ExprNode, type FilterExpr, literal } from "@uwdata/mosaic-sql";

/**
 * Convert a Mosaic FilterExpr (array | boolean | string | ExprNode) into a
 * single ExprNode suitable for SUM(CAST(expr AS INT)) aggregation.
 *
 * If the filter is empty/null, returns literal(true) so all rows count.
 */
export function filterExprToExpr(filter: FilterExpr | null | undefined): ExprNode {
    if (filter == null) return literal(true) as ExprNode;
    if (typeof filter === "boolean") return literal(filter) as ExprNode;
    if (typeof filter === "string") return literal(true) as ExprNode;
    if (Array.isArray(filter)) {
        const exprs = filter.filter((f): f is ExprNode => f != null && typeof f !== "boolean" && typeof f !== "string");
        if (exprs.length === 0) return literal(true) as ExprNode;
        if (exprs.length === 1) return exprs[0];
        return and(...exprs) as ExprNode;
    }
    return filter as ExprNode;
}

/**
 * Coerce a Mosaic query result to a plain array of row objects.
 * Mosaic may return an Array or an Arrow-like Iterable.
 */
export function toRows<T = Record<string, unknown>>(result: unknown): T[] {
    return Array.isArray(result) ? result : Array.from(result as Iterable<T>);
}

/**
 * Rebuild the `dataset` VIEW after ALTER TABLE on obs_base.
 *
 * DuckDB VIEWs cache column types — adding a column to obs_base invalidates
 * the cached schema. This rebuilds the VIEW with all emb_* LEFT JOINs.
 */
export async function rebuildDatasetView(coordinator: Coordinator): Promise<void> {
    const tables = await coordinator.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'main' AND table_name LIKE 'emb_%'`,
        { type: "json" },
    );
    const embTables = toRows<{ table_name: string }>(tables).map((r) => r.table_name);

    const joins = embTables.map((t) => `LEFT JOIN ${t} USING (__row_index__)`).join(" ");
    await coordinator.exec(`CREATE OR REPLACE VIEW dataset AS SELECT * FROM obs_base ${joins}`);
}
