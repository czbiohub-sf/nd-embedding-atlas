import type { PredicatePortValue } from "@ndea/sdk/graph";

/**
 * Tagged graph-runtime values retain the port kind needed by the evaluator while
 * their payload domains come directly from the public SDK author contract.
 */
export interface GraphPredicatePortValue {
  readonly kind: "pred";
  readonly sql: PredicatePortValue;
}

export type GraphPortValue = GraphPredicatePortValue;
