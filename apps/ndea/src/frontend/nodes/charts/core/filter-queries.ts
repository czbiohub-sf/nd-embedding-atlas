import {
  type ExprNode,
  type FilterExpr,
  asc,
  cast,
  column,
  count,
  desc,
  isNotNull,
  Query,
  sum,
} from "@uwdata/mosaic-sql";

import { filterExprToExpr } from "@/lib/mosaic-helpers";

export function buildCountPlotQuery(table: string, textExpr: ExprNode, limit: number, predicate: FilterExpr) {
  const pred = filterExprToExpr(predicate);
  return Query.from(table)
    .select({
      value: textExpr,
      count: count(),
      countSelected: sum(cast(pred, "INT")),
    })
    .groupby(textExpr)
    .orderby(isNotNull(textExpr), desc(count()), asc("value"))
    .limit(limit);
}

export function buildHistogramStatsQuery(table: string, field: string, predicate: FilterExpr): string {
  const fieldExpr = cast(column(field), "DOUBLE");
  const pred = filterExprToExpr(predicate);
  return `SELECT MIN(${String(fieldExpr)}) AS min,
                 MAX(${String(fieldExpr)}) AS max,
                 COUNT(*) AS count,
                 SUM(CAST((${String(pred)}) AS INT)) AS "countFiltered"
          FROM ${table}
          WHERE ${String(fieldExpr)} IS NOT NULL AND isfinite(${String(fieldExpr)})`;
}
