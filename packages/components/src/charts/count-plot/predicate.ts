/** Typed filter for count-plot categories, which are grouped as text. */
import type { FilterClause } from "@ndea/protocol";

export const NULL_VALUE = "__null__";

export function countPlotPredicate(column: string, selected: ReadonlySet<string>): FilterClause | null {
  if (selected.size === 0) return null;
  const values = [...selected].filter((value) => value !== NULL_VALUE);
  const clauses: FilterClause[] = [];
  if (values.length) clauses.push({ op: "in", column, values });
  if (selected.has(NULL_VALUE)) clauses.push({ op: "isNull", column });
  return clauses.length === 1 ? clauses[0] : { op: "or", clauses };
}
