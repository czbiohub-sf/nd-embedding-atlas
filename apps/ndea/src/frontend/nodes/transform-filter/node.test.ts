import { describe, expect, test } from "bun:test";
import type { GraphNodeRegistrationContext } from "@/core/graph/evaluator";
import type { GraphCookFunction } from "@/core/graph/engine";
import type { GraphPortValue } from "@/core/graph/values";
import { thresholdNode } from "./node";

describe("threshold graph runtime adapter", () => {
  test("routes the graph predicate through the SDK definition's filter-in port", () => {
    let cook: GraphCookFunction<GraphPortValue> | undefined;
    let dispose: (() => void) | undefined;
    const registration: GraphNodeRegistrationContext = {
      id: "threshold-1",
      coordinator: { query: () => Promise.resolve([]) },
      table: "atlas",
      metadata: { dataset_keys: [] } as never,
      addNode(_kind, registeredCook) {
        cook = registeredCook;
      },
      markDirty() {},
      onDispose(registeredDispose) {
        dispose = registeredDispose;
      },
      setTransformHost() {},
    };

    thresholdNode.graph.registerEvaluation?.(registration);
    expect(cook).toBeDefined();
    const result = cook!(new Map([["in", [{ kind: "pred", sql: "score > 0.25" }]]]), {
      signal: new AbortController().signal,
      epoch: 1,
    });

    expect(result).toEqual({ kind: "pred", sql: "score > 0.25" });
    dispose?.();
  });
});
