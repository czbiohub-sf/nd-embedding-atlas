declare const ROW_INDEX: unique symbol;

export type RowIndex = number & { readonly [ROW_INDEX]: true };

export function rowIndex(value: number): RowIndex {
  return value as RowIndex;
}

/** A pull-time SQL predicate. `null` means all rows. */
export type PredicatePortValue = string | null;
export type NodePortValue = PredicatePortValue;

export interface NodeComputeContext {
  readonly signal: AbortSignal;
  readonly epoch: number;
}

export type NodeComputeInputs = ReadonlyMap<string, readonly NodePortValue[]>;
export type NodeComputeOutputs = ReadonlyMap<string, NodePortValue>;
export type NodeCompute = (
  inputs: NodeComputeInputs,
  context: NodeComputeContext,
) => NodeComputeOutputs | Promise<NodeComputeOutputs>;
