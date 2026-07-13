import type {
  NodeCompute,
  NodeComputeInputs,
  NodeComputeOutputs,
  NodeRuntime,
  NodePortValue,
  PortKind,
  PredicatePortValue,
  JsonValue,
} from "@ndea/sdk";
import { andPreds, type GraphCookFunction, type Predicate } from "./engine";
import type { GraphDocumentNode } from "./records";
import type { GraphFocusPortValue, GraphPortValue, GraphPredicatePortValue, GraphRowSetPortValue } from "./values";

export type GraphPortValueInputs = ReadonlyMap<string, readonly GraphPortValue[]>;

export const NULL_PREDICATE_PORT_VALUE: GraphPredicatePortValue = { kind: "pred", sql: null };

export function predicateSql(value: GraphPortValue | undefined): PredicatePortValue {
  return !value || value.kind === "focus" ? null : value.sql;
}

export function predicateSqls(inputs: GraphPortValueInputs): Predicate[] {
  const predicates: Predicate[] = [];
  for (const values of inputs.values()) {
    for (const value of values) predicates.push(predicateSql(value));
  }
  return predicates;
}

export function lastPortValueOfKind<K extends GraphPortValue["kind"]>(
  inputs: GraphPortValueInputs,
  kind: K,
): Extract<GraphPortValue, { kind: K }> | undefined {
  let latest: Extract<GraphPortValue, { kind: K }> | undefined;
  for (const values of inputs.values()) {
    for (const value of values) {
      if (value.kind === kind) latest = value as Extract<GraphPortValue, { kind: K }>;
    }
  }
  return latest;
}

export function passthroughGraphPredicate(inputs: GraphPortValueInputs): GraphPredicatePortValue {
  return { kind: "pred", sql: andPreds(predicateSqls(inputs)) };
}

export function consumeGraphRowSet(inputs: GraphPortValueInputs): GraphPortValue {
  return lastPortValueOfKind(inputs, "sel") ?? passthroughGraphPredicate(inputs);
}

export function andGraphPredicate(inputs: GraphPortValueInputs, extra: PredicatePortValue): GraphPredicatePortValue {
  const predicates = predicateSqls(inputs);
  predicates.push(extra);
  return { kind: "pred", sql: andPreds(predicates) };
}

export function nodeConfig<C extends object>(node: GraphDocumentNode | undefined): Partial<C> {
  return (node?.config as Partial<C> | undefined) ?? {};
}

export function patchNodeConfig(node: GraphDocumentNode | undefined, patch: Record<string, JsonValue>): JsonValue {
  return { ...(node?.config as Record<string, JsonValue> | undefined), ...patch };
}

export interface GraphNodeCookHost {
  readonly id: string;
  node(): GraphDocumentNode | undefined;
  frozenPredicate(): PredicatePortValue | undefined;
}

export type GraphNodeCookFunction = (inputs: GraphPortValueInputs, host: GraphNodeCookHost) => GraphPortValue;

export function toNodePortValue(value: GraphPortValue): NodePortValue {
  switch (value.kind) {
    case "pred":
      return value.sql;
    case "sel":
      return value.rowIds;
    case "focus":
      return value.rowIndex;
  }
}

export function toNodeComputeInputs(inputs: GraphPortValueInputs): NodeComputeInputs {
  const computeInputs = new Map<string, NodePortValue[]>();
  for (const [port, values] of inputs) {
    computeInputs.set(
      port,
      values.map((value) => toNodePortValue(value)),
    );
  }
  return computeInputs;
}

export function fromNodePortValue(kind: "pred", value: NodePortValue): GraphPredicatePortValue;
export function fromNodePortValue(kind: "sel", value: NodePortValue): GraphRowSetPortValue;
export function fromNodePortValue(kind: "focus", value: NodePortValue): GraphFocusPortValue;
export function fromNodePortValue(kind: PortKind, value: NodePortValue): GraphPortValue;
export function fromNodePortValue(kind: PortKind, value: NodePortValue): GraphPortValue {
  switch (kind) {
    case "pred":
      return { kind, sql: value as PredicatePortValue };
    case "sel":
      return { kind, sql: null, rowIds: value as GraphRowSetPortValue["rowIds"] };
    case "focus":
      return { kind, rowIndex: value as GraphFocusPortValue["rowIndex"] };
  }
}

/**
 * Adapt the public SDK compute contract to the synchronous graph evaluator.
 * Async runtimes remain lifecycle-driven and publish through their host.
 */
export function adaptNodeCompute(
  compute: NodeCompute,
  outputPort: string,
  outputKind: PortKind,
): GraphCookFunction<GraphPortValue> {
  return (inputs, context) => {
    const outputs = compute(toNodeComputeInputs(inputs), context);
    if (outputs instanceof Promise) {
      throw new TypeError("graph: async SDK compute requires a host-driven node runtime");
    }
    return graphOutput(outputs, outputPort, outputKind);
  };
}

export function assertSynchronousNodeRuntime(result: ReturnType<NonNullable<NodeRuntime["recompute"]>>): void {
  if (result instanceof Promise) {
    throw new TypeError("graph: asynchronous node runtime requires an asynchronous evaluator");
  }
}

function graphOutput(outputs: NodeComputeOutputs, outputPort: string, outputKind: PortKind): GraphPortValue {
  if (!outputs.has(outputPort)) throw new Error(`graph: SDK compute did not produce output port '${outputPort}'`);
  return fromNodePortValue(outputKind, outputs.get(outputPort) as NodePortValue);
}
