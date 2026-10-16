import { describe, expect, test } from "vite-plus/test";
import { countPlotPredicate, NULL_VALUE } from "./predicate";

describe("countPlotPredicate", () => {
  test("empty selection clears", () => {
    expect(countPlotPredicate("species", new Set())).toBeNull();
  });
  test("categories remain strings", () => {
    expect(countPlotPredicate("species", new Set(["1", "true"]))).toEqual({
      op: "in",
      column: "species",
      values: ["1", "true"],
    });
  });
  test("null bucket", () => {
    expect(countPlotPredicate("species", new Set([NULL_VALUE]))).toEqual({ op: "isNull", column: "species" });
  });
  test("null bucket and categories", () => {
    expect(countPlotPredicate("species", new Set(["a", NULL_VALUE]))).toEqual({
      op: "or",
      clauses: [
        { op: "in", column: "species", values: ["a"] },
        { op: "isNull", column: "species" },
      ],
    });
  });
});
