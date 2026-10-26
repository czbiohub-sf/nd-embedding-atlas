/** Mosaic glue shared by the views and the app: query results, predicates, selections. */

import type { Selection } from "@uwdata/mosaic-core";
import { and, type ExprNode, type FilterExpr, literal } from "@uwdata/mosaic-sql";
import { useCallback, useSyncExternalStore } from "react";

/** A Mosaic client's filter as one expression: only expression nodes filter; null, booleans, and strings read as `true`. */
export function filterExprToExpr(filter: FilterExpr | null | undefined): ExprNode {
  if (filter == null) return literal(true);
  if (typeof filter === "boolean") return literal(filter);
  if (typeof filter === "string") return literal(true);
  if (Array.isArray(filter)) {
    const exprs = filter.filter((item): item is ExprNode => typeof item === "object" && item !== null);
    if (exprs.length === 0) return literal(true);
    return exprs.length === 1 ? exprs[0] : and(...exprs);
  }
  return filter;
}

/** A query result as row objects: Mosaic returns an Array or an Arrow-like Iterable. */
export function toRows<T = Record<string, unknown>>(result: unknown): T[] {
  return Array.isArray(result) ? result : Array.from(result as Iterable<T>);
}

/** A selection's current predicate as a SQL WHERE clause; null when nothing filters. */
export function predicateToSql(selection: Selection): string | null {
  const predicate = selection.predicate(null);
  if (predicate == null) return null;
  if (Array.isArray(predicate)) {
    if (!predicate.length) return null;
    return and(...predicate)
      .toString()
      .trim();
  }
  if (typeof predicate === "string") return predicate.trim() || null;
  if (typeof predicate === "boolean") return literal(predicate).toString();
  return predicate.toString().trim();
}

/** `predicateToSql(selection)`, re-read whenever the selection (which mutates in place) changes. */
export function usePredicateSql(selection: Selection): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      selection.addEventListener("value", onChange);
      return () => selection.removeEventListener("value", onChange);
    },
    [selection],
  );
  return useSyncExternalStore(subscribe, () => predicateToSql(selection));
}

/**
 * Raw SQL as a Mosaic predicate. Mosaic only calls `.toString()` on
 * predicates, so this one cast bridges a string to the nominal `ExprNode`.
 */
export function stringPredicate(sql: string): ExprNode {
  return { toString: () => sql } as unknown as ExprNode;
}
