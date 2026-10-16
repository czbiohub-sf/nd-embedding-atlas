/**
 * Shared Mosaic SQL utilities for chart components.
 */

import type { Selection } from "@uwdata/mosaic-core";
import { and, type ExprNode, literal } from "@uwdata/mosaic-sql";

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
 * Mosaic calls .toString() on predicates when building SQL: this satisfies
 * that contract without requiring full AST construction.
 *
 * The cast is intentional: ExprNode is a nominal class, but Mosaic only needs
 * the .toString() contract at runtime. This is the single escape hatch for
 * string → ExprNode bridging; all call sites should use this helper instead of
 * `as any` / `as unknown as`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stringPredicate(sql: string): ExprNode {
  // biome-ignore lint/suspicious/noExplicitAny: intentional bridge: see JSDoc
  return { toString: () => sql } as unknown as ExprNode;
}
