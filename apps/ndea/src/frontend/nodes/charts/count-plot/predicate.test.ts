import { describe, expect, test } from "bun:test";
import { cast, column } from "@uwdata/mosaic-sql";

import { countPlotPredicate, NULL_VALUE } from "./predicate";

const textExpr = cast(column("species"), "TEXT");

describe("countPlotPredicate", () => {
  test("empty selection → null (clear)", () => {
    expect(countPlotPredicate(textExpr, new Set())).toBeNull();
  });

  test("single value → equality predicate", () => {
    const sql = countPlotPredicate(textExpr, new Set(["setosa"]));
    expect(sql).toContain("'setosa'");
    expect(sql).toContain("NOT DISTINCT FROM");
  });

  test("multiple values → OR of equalities", () => {
    const sql = countPlotPredicate(textExpr, new Set(["a", "b"]));
    expect(sql).toContain("'a'");
    expect(sql).toContain("'b'");
    expect(sql).toContain(" OR ");
  });

  test("null sentinel → IS NULL bucket", () => {
    const sql = countPlotPredicate(textExpr, new Set([NULL_VALUE]));
    expect(sql).toContain("IS NULL");
  });
});
