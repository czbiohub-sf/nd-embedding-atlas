import type { FocusPortValue, PredicatePortValue, RowSetPortValue } from "@ndea/sdk/graph";

export const AUTHORED_GRAPH_OUTPUT_PORT = "push";
export const DERIVED_GRAPH_OUTPUT_PORT = "out";

/**
 * Tagged graph-runtime values retain the port kind needed by the evaluator while
 * their payload domains come directly from the public SDK author contract.
 */
export interface GraphPredicatePortValue {
  readonly kind: "pred";
  readonly sql: PredicatePortValue;
}

export interface GraphRowSetPortValue {
  readonly kind: "sel";
  readonly sql: PredicatePortValue;
  readonly rowIds: RowSetPortValue;
}

export interface GraphFocusPortValue {
  readonly kind: "focus";
  readonly rowIndex: FocusPortValue;
}

export type GraphPortValue = GraphPredicatePortValue | GraphRowSetPortValue | GraphFocusPortValue;
