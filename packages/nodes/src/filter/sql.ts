import { OBSERVATION_SET_TABLE, type FilterClause } from "@ndea/protocol";
import {
  and,
  column,
  eq,
  type ExprNode,
  gt,
  gte,
  isBetween,
  isIn,
  isNotNull,
  isNull,
  literal,
  lt,
  lte,
  neq,
  not,
  or,
  sql,
} from "@uwdata/mosaic-sql";

const COMPARE = { eq, neq, lt, lte, gt, gte } as const;

/** Decode a validated clause into Mosaic expression nodes. */
export function filterClauseExpr(clause: FilterClause): ExprNode {
  switch (clause.op) {
    case "eq":
    case "neq":
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      return COMPARE[clause.op](column(clause.column), literal(clause.value));
    case "between":
      return isBetween(column(clause.column), [literal(clause.range[0]), literal(clause.range[1])]);
    case "in":
      return isIn(column(clause.column), clause.values.map(literal));
    case "isNull":
      return isNull(column(clause.column));
    case "isNotNull":
      return isNotNull(column(clause.column));
    case "and":
      return and(clause.clauses.map(filterClauseExpr));
    case "or":
      return or(clause.clauses.map(filterClauseExpr));
    case "not":
      return not(filterClauseExpr(clause.clause));
    case "inSet":
      return sql`${column("__row_index__")} IN (SELECT __row_index__ FROM ${OBSERVATION_SET_TABLE} WHERE set_id = ${literal(clause.set)})`;
  }
}

/** The SQL WHERE fragment every filter consumer executes. */
export function filterClauseSql(clause: FilterClause): string {
  return String(filterClauseExpr(clause));
}
