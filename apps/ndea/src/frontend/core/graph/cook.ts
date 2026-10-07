import type {
  NodeCompute,
  NodeComputeInputs,
  NodeComputeOutputs,
  NodeComputeContext,
  NodeRuntime,
  NodePortValue,
  PortKind,
  PredicatePortValue,
  JsonValue,
} from "@ndea/sdk";
import {
  andPreds,
  type GraphCookFunction,
  type GraphPortValue,
  type GraphPredicatePortValue,
  type Predicate,
} from "@ndea/graph";
import type { GraphDocumentNode } from "./records";

export type GraphPortValueInputs = ReadonlyMap<string, readonly GraphPortValue[]>;

export const NULL_PREDICATE_PORT_VALUE: GraphPredicatePortValue = { kind: "pred", sql: null };

export function predicateSql(value: GraphPortValue | undefined): PredicatePortValue {
  return value?.sql ?? null;
}

export function predicateSqls(inputs: GraphPortValueInputs): Predicate[] {
  const predicates: Predicate[] = [];
  for (const values of inputs.values()) {
    for (const value of values) predicates.push(predicateSql(value));
  }
  return predicates;
}

export function passthroughGraphPredicate(inputs: GraphPortValueInputs): GraphPredicatePortValue {
  return { kind: "pred", sql: andPreds(predicateSqls(inputs)) };
}

export function andGraphPredicate(inputs: GraphPortValueInputs, extra: PredicatePortValue): GraphPredicatePortValue {
  const predicates = predicateSqls(inputs);
  predicates.push(extra);
  return { kind: "pred", sql: andPreds(predicates) };
}

export function nodeConfig<C extends object>(node: GraphDocumentNode | undefined): Partial<C> {
  return (node?.config?.value as Partial<C> | undefined) ?? {};
}

export function patchNodeConfig(node: GraphDocumentNode | undefined, patch: Record<string, JsonValue>): JsonValue {
  return { ...(node?.config?.value as Record<string, JsonValue> | undefined), ...patch };
}

export interface GraphNodeCookHost {
  readonly id: string;
  node(): GraphDocumentNode | undefined;
  scopeFilter(): PredicatePortValue;
}

export type GraphNodeCookFunction = (
  inputs: GraphPortValueInputs,
  host: GraphNodeCookHost,
  context?: NodeComputeContext,
) => GraphPortValue;

export function toNodePortValue(value: GraphPortValue): NodePortValue {
  return value.sql;
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

export function fromNodePortValue(kind: PortKind, value: NodePortValue): GraphPortValue {
  return { kind, sql: value };
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
