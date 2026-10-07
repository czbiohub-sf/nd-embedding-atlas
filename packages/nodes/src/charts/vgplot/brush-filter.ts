import type { FilterClause, FilterValue } from "@ndea/protocol";
import type { ExprNode } from "@uwdata/mosaic-sql";
import {
  BetweenOpNode,
  BinaryOpNode,
  ColumnNameRefNode,
  InOpNode,
  LiteralNode,
  LogicalOpNode,
  TupleNode,
  UnaryOpNode,
  UnaryPostfixOpNode,
} from "@uwdata/mosaic-sql";

function literalValue(node: ExprNode): FilterValue | undefined {
  if (!(node instanceof LiteralNode)) return undefined;
  const value = node.value;
  return typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
    ? value
    : undefined;
}

/** Closed subset of Mosaic brushes that can be persisted without SQL. */
export function brushFilterClause(node: unknown): FilterClause | null {
  if (Array.isArray(node)) return logicalClause("and", node);
  if (node instanceof LogicalOpNode) {
    if (node.op !== "AND" && node.op !== "OR") return null;
    return logicalClause(node.op === "AND" ? "and" : "or", node.clauses);
  }
  if (node instanceof UnaryOpNode && node.op === "NOT") {
    const clause = brushFilterClause(node.expr);
    return clause ? { op: "not", clause } : null;
  }
  if (node instanceof UnaryPostfixOpNode && node.expr instanceof ColumnNameRefNode) {
    if (node.op === "IS NULL") return { op: "isNull", column: node.expr.column };
    if (node.op === "IS NOT NULL") return { op: "isNotNull", column: node.expr.column };
  }
  if (node instanceof BetweenOpNode && node.expr instanceof ColumnNameRefNode && node.extent) {
    const lo = literalValue(node.extent[0]);
    const hi = literalValue(node.extent[1]);
    return lo === undefined || hi === undefined ? null : { op: "between", column: node.expr.column, range: [lo, hi] };
  }
  if (node instanceof InOpNode && node.expr instanceof ColumnNameRefNode && node.values instanceof TupleNode) {
    const values = node.values.values.map(literalValue);
    if (!values.length || values.some((value) => value === undefined)) return null;
    return {
      op: "in",
      column: node.expr.column,
      values: values.filter((value): value is FilterValue => value !== undefined),
    };
  }
  if (node instanceof BinaryOpNode && node.left instanceof ColumnNameRefNode) {
    const column = node.left.column;
    if (node.op === "IS NOT DISTINCT FROM" && node.right instanceof LiteralNode && node.right.value === null) {
      return { op: "isNull", column };
    }
    const value = literalValue(node.right);
    if (value === undefined) return null;
    switch (node.op) {
      case "=":
        return { op: "eq", column, value };
      case "IS NOT DISTINCT FROM":
        return {
          op: "and",
          clauses: [
            { op: "isNotNull", column },
            { op: "eq", column, value },
          ],
        };
      case "<>":
        return { op: "neq", column, value };
      case "<":
        return { op: "lt", column, value };
      case "<=":
        return { op: "lte", column, value };
      case ">":
        return { op: "gt", column, value };
      case ">=":
        return { op: "gte", column, value };
    }
  }
  return null;
}

function logicalClause(op: "and" | "or", nodes: readonly unknown[]): FilterClause | null {
  if (!nodes.length) return null;
  const clauses: FilterClause[] = [];
  for (const node of nodes) {
    const clause = brushFilterClause(node);
    if (!clause) return null;
    clauses.push(clause);
  }
  return { op, clauses };
}
