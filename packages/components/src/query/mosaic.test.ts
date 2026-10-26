import { describe, expect, test } from "bun:test";
import { and, column, gt, literal, lt } from "@uwdata/mosaic-sql";
import { filterExprToExpr, toRows } from "./mosaic";

describe("filterExprToExpr", () => {
  const a = gt(column("a"), literal(1));
  const b = lt(column("b"), literal(2));

  test("no filter, booleans, and strings", () => {
    expect(String(filterExprToExpr(null))).toBe(String(literal(true)));
    expect(String(filterExprToExpr(false))).toBe(String(literal(false)));
    expect(String(filterExprToExpr("x > 1"))).toBe(String(literal(true)));
    expect(filterExprToExpr(a)).toBe(a);
  });

  test("arrays keep only expression nodes", () => {
    expect(String(filterExprToExpr([true, "x > 1"]))).toBe(String(literal(true)));
    expect(filterExprToExpr([a, false])).toBe(a);
    expect(String(filterExprToExpr([a, "x > 1", b]))).toBe(String(and(a, b)));
  });
});

test("toRows reads arrays and iterables", () => {
  const rows = [{ n: 1 }];
  expect(toRows(rows)).toBe(rows);
  expect(toRows(new Set(rows))).toEqual(rows);
});
