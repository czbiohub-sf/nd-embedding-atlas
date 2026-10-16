/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { cast, column } from "@uwdata/mosaic-sql";

import { buildCountPlotQuery, buildHistogramStatsQuery } from "./filter-queries";

describe("filter-coordinated chart counts", () => {
  test("Count Plot keeps total counts and preserves an active-empty filtered count", () => {
    const sql = String(buildCountPlotQuery("dataset", cast(column("kind"), "TEXT"), 11, false)).toUpperCase();

    expect(sql).toContain("COUNT(*)");
    expect(sql).toContain("FALSE");
  });

  test("Histogram keeps its domain count and preserves an active-empty filtered count", () => {
    const sql = buildHistogramStatsQuery("dataset", "value", false);

    expect(sql).toContain("COUNT(*) AS count");
    expect(sql).toContain("FALSE");
    expect(sql).toContain('AS "countFiltered"');
  });
});
