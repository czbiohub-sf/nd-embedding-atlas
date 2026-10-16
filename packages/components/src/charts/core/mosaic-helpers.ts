import { and, type ExprNode, type FilterExpr, literal } from "@uwdata/mosaic-sql";

export function filterExprToExpr(filter: FilterExpr | null | undefined): ExprNode {
  if (filter == null) return literal(true);
  if (typeof filter === "boolean") return literal(filter);
  if (typeof filter === "string") return literal(true);
  if (Array.isArray(filter)) {
    const exprs = filter.filter((item): item is ExprNode => item != null && typeof item === "object");
    if (exprs.length === 0) return literal(true);
    return exprs.length === 1 ? exprs[0] : and(...exprs);
  }
  return filter;
}

export function toRows<T = Record<string, unknown>>(result: unknown): T[] {
  return Array.isArray(result) ? result : Array.from(result as Iterable<T>);
}
