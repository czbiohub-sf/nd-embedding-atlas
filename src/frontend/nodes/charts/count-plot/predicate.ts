/** Pure predicate builder for a count-plot's bar selection (testable without a coordinator). */

import { type ExprNode, isNotDistinct, isNull, literal, or } from "@uwdata/mosaic-sql";

/** Sentinel for the SQL-NULL bucket in the selected set (a category value can't be the JS null). */
export const NULL_VALUE = "__null__";

/**
 * The OR-of-equality filter for a set of picked category values; `null` = no filter (clear).
 * Mirrors the legacy CountPlot click handler exactly.
 */
export function countPlotPredicate(textExpr: ExprNode, selected: ReadonlySet<string>): string | null {
  if (selected.size === 0) return null;
  const predicates = [...selected].map((v) =>
    v === NULL_VALUE ? (isNull(textExpr) as ExprNode) : (isNotDistinct(textExpr, literal(v)) as ExprNode),
  );
  return String(or(...predicates));
}
