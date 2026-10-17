import { expect, test } from "bun:test";
import { cast, column, isBetween, isIn, literal } from "@uwdata/mosaic-sql";
import { brushFilterClause } from "./brush-filter";

test("converts intervals and points, rejects expressions outside the typed filter subset", () => {
  expect(brushFilterClause(isBetween(column("x"), [literal(1), literal(5)]))).toEqual({
    op: "between",
    column: "x",
    range: [1, 5],
  });
  expect(brushFilterClause(isIn(column("kind"), [literal("a"), literal("b")]))).toEqual({
    op: "in",
    column: "kind",
    values: ["a", "b"],
  });
  expect(brushFilterClause(isBetween(cast(column("x"), "DOUBLE"), [literal(1), literal(5)]))).toBeNull();
  expect(brushFilterClause(isBetween(column("x"), [literal(new Date()), literal(new Date())]))).toBeNull();
});
