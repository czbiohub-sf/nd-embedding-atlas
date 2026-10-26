import { describe, expect, test } from "bun:test";
import { type ColumnType, columnType, quoteIdent } from "./columns";

describe("columnType", () => {
  test("maps DuckDB types to column types, case-insensitively", () => {
    const types: Record<string, ColumnType> = {
      INTEGER: "number",
      BIGINT: "number",
      DOUBLE: "number",
      "DECIMAL(18,3)": "number",
      VARCHAR: "string",
      varchar: "string",
      "ENUM('a','b')": "string",
      "ENUM('interphase', 'real', 'bool_flag')": "string",
      BOOLEAN: "boolean",
      TIMESTAMP: "other",
      "FLOAT[]": "number",
    };
    expect(Object.fromEntries(Object.keys(types).map((t) => [t, columnType(t)]))).toEqual(types);
  });
});

test("quoteIdent doubles embedded quotes", () => {
  expect(quoteIdent('x" ; DROP TABLE obs_base; --')).toBe('"x"" ; DROP TABLE obs_base; --"');
});
