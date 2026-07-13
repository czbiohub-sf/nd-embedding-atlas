import { describe, expect, test } from "bun:test";
import type { NodeCompute, NodeComputeContext } from "@ndea/sdk";
import { adaptNodeCompute, assertSynchronousNodeRuntime, toNodeComputeInputs } from "./cook";
import type { GraphPortValueInputs } from "./cook";

const context: NodeComputeContext = {
  signal: new AbortController().signal,
  epoch: 7,
};

describe("SDK compute graph adapter", () => {
  test("rejects asynchronous runtimes before the evaluator caches an output", () => {
    expect(() => assertSynchronousNodeRuntime(Promise.resolve())).toThrow(
      "asynchronous node runtime requires an asynchronous evaluator",
    );
    expect(assertSynchronousNodeRuntime()).toBeUndefined();
  });

  test("passes public SDK port payloads to author compute without Workspace contracts", () => {
    const inputs: GraphPortValueInputs = new Map([
      ["predicate", [{ kind: "pred", sql: "x > 2" }]],
      ["rows", [{ kind: "sel", sql: "__row_index__ IN (2, 5)", rowIds: [2, 5] }]],
      ["focus", [{ kind: "focus", obsId: "cell-5" }]],
    ]);

    expect(toNodeComputeInputs(inputs)).toEqual(
      new Map([
        ["predicate", ["x > 2"]],
        ["rows", [[2, 5]]],
        ["focus", ["cell-5"]],
      ]),
    );
  });

  test("adapts a synchronous SDK compute output back to the tagged evaluator value", () => {
    const compute: NodeCompute = (inputs, computeContext) => {
      expect(inputs.get("filter-in")).toEqual(["x > 2"]);
      expect(computeContext).toBe(context);
      return new Map([["out", "(x > 2) AND (score > 0.5)"]]);
    };
    const cook = adaptNodeCompute(compute, "out", "pred");

    expect(cook(new Map([["filter-in", [{ kind: "pred", sql: "x > 2" }]]]), context)).toEqual({
      kind: "pred",
      sql: "(x > 2) AND (score > 0.5)",
    });
  });

  test("reports missing outputs and unsupported async author compute", () => {
    const missing = adaptNodeCompute(() => new Map(), "out", "pred");
    expect(() => missing(new Map(), context)).toThrow("did not produce output port 'out'");

    const asynchronous = adaptNodeCompute(() => Promise.resolve(new Map([["out", null]])), "out", "pred");
    expect(() => asynchronous(new Map(), context)).toThrow("async SDK compute requires a host-driven node runtime");
  });
});
