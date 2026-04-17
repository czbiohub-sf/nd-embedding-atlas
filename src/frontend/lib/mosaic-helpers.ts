/**
 * Shared Mosaic SQL utilities for chart components.
 */

import type { Selection } from "@uwdata/mosaic-core";
import { and, type ExprNode, type FilterExpr, literal } from "@uwdata/mosaic-sql";

/**
 * Convert a Mosaic FilterExpr (array | boolean | string | ExprNode) into a
 * single ExprNode suitable for SUM(CAST(expr AS INT)) aggregation.
 *
 * If the filter is empty/null, returns literal(true) so all rows count.
 */
export function filterExprToExpr(filter: FilterExpr | null | undefined): ExprNode {
  if (filter == null) return literal(true);
  if (typeof filter === "boolean") return literal(filter);
  if (typeof filter === "string") return literal(true);
  if (Array.isArray(filter)) {
    const exprs = filter.filter((f): f is ExprNode => f != null && typeof f !== "boolean" && typeof f !== "string");
    if (exprs.length === 0) return literal(true);
    if (exprs.length === 1) return exprs[0];
    return and(...exprs);
  }
  return filter;
}

/**
 * Coerce a Mosaic query result to a plain array of row objects.
 * Mosaic may return an Array or an Arrow-like Iterable.
 */
export function toRows<T = Record<string, unknown>>(result: unknown): T[] {
  return Array.isArray(result) ? result : Array.from(result as Iterable<T>);
}

/**
 * Convert a Mosaic Selection's current predicate to a SQL WHERE clause string.
 * Returns null if the selection has no active predicate.
 *
 * Follows Apple's predicateToString() pattern from embedding-atlas.
 */
export function predicateToSql(selection: Selection): string | null {
  const predicate = selection.predicate(null);
  if (predicate == null) return null;
  if (Array.isArray(predicate)) {
    if (predicate.length === 0) return null;
    return and(...predicate)
      .toString()
      .trim();
  }
  if (typeof predicate === "string") return predicate.trim() || null;
  if (typeof predicate === "boolean") return literal(predicate).toString();
  return predicate.toString().trim();
}

/**
 * Wraps a raw SQL string as a Mosaic-compatible ExprNode.
 * Mosaic calls .toString() on predicates when building SQL — this satisfies
 * that contract without requiring full AST construction.
 *
 * The cast is intentional: ExprNode is a nominal class, but Mosaic only needs
 * the .toString() contract at runtime. This is the single escape hatch for
 * string → ExprNode bridging; all call sites should use this helper instead of
 * `as any` / `as unknown as`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stringPredicate(sql: string): ExprNode {
  // biome-ignore lint/suspicious/noExplicitAny: intentional bridge — see JSDoc
  return { toString: () => sql } as unknown as ExprNode;
}
