// Package-level wire contract tests.
import { describe, expect, test } from "bun:test";
import { CommitAnnotationsResponseSchema, CommitDatasetReportSchema } from "./index.ts";

describe("CommitAnnotationsResponseSchema", () => {
  test("parses a success dataset report", () => {
    const r = CommitDatasetReportSchema.safeParse({
      datasetKey: "ds1",
      path: "/data/x.zarr",
      format: "v3",
      nObs: 50_000,
      columns: [{ name: "cell_type", kind: "categorical", nNonNull: 1240 }],
      written: false,
    });
    expect(r.success).toBe(true);
  });

  test("parses a remote/error skip report", () => {
    const r = CommitDatasetReportSchema.safeParse({
      datasetKey: "ds2",
      path: "https://remote/x.zarr",
      error: "remote stores can't be written back yet",
    });
    expect(r.success).toBe(true);
  });

  test("error member discriminates — no columns/format to dereference", () => {
    const skip = CommitDatasetReportSchema.parse({ datasetKey: "d", error: "no source dataset for this key" });
    expect("error" in skip).toBe(true);
    expect("columns" in skip).toBe(false);
    expect("format" in skip).toBe(false);
  });

  test("full response wraps dryRun + a mixed datasets array", () => {
    const r = CommitAnnotationsResponseSchema.parse({
      dryRun: true,
      datasets: [
        { datasetKey: "a", path: "/a.zarr", format: "v2", nObs: 10, columns: [], written: false },
        { datasetKey: "b", error: "remote stores can't be written back yet" },
      ],
    });
    expect(r.dryRun).toBe(true);
    expect(r.datasets).toHaveLength(2);
  });

  test("rejects a success shape missing required fields", () => {
    const r = CommitDatasetReportSchema.safeParse({ datasetKey: "a", path: "/a.zarr", format: "v3" });
    expect(r.success).toBe(false);
  });
});
