/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { CommitAnnotationsResponse } from "@ndea/protocol";
import { commitStatusMessage, commitSummary, datasetRows } from "./commit-report.ts";

const success = {
  datasetKey: "a",
  path: "/a.zarr",
  format: "v3" as const,
  nObs: 50_000,
  columns: [{ name: "cell_type", kind: "categorical", nNonNull: 1240 }],
  written: false,
};
const remote = { datasetKey: "b", path: "https://r/x.zarr", error: "remote stores can't be written back yet" };

function resp(datasets: CommitAnnotationsResponse["datasets"]): CommitAnnotationsResponse {
  return { dryRun: true, datasets };
}

describe("datasetRows", () => {
  test("success row keeps columns/format; error row has none (no crash to dereference)", () => {
    const rows = datasetRows(resp([success, remote]));
    expect(rows[0].error).toBeNull();
    expect(rows[0].columns).toHaveLength(1);
    expect(rows[1].error).toBe("remote stores can't be written back yet");
    expect(rows[1].columns).toBeUndefined();
    expect(rows[1].format).toBeUndefined();
  });

  test("null report → no rows", () => {
    expect(datasetRows(null)).toEqual([]);
  });
});

describe("commitSummary", () => {
  test("mixed local + remote", () => {
    const s = commitSummary(resp([success, remote]));
    expect(s).toEqual({ writableCount: 1, failedCount: 1, columnsWritten: 1, allBlocked: false });
  });

  test("all remote/error → allBlocked (Confirm disabled)", () => {
    const s = commitSummary(resp([remote, { datasetKey: "c", error: "no source dataset for this key" }]));
    expect(s.writableCount).toBe(0);
    expect(s.allBlocked).toBe(true);
  });

  test("empty datasets → not allBlocked", () => {
    expect(commitSummary(resp([])).allBlocked).toBe(false);
  });

  test("sums columns across writable datasets only", () => {
    const success2 = {
      ...success,
      datasetKey: "d",
      columns: [success.columns[0], { name: "stage", kind: "string", nNonNull: 10 }],
    };
    expect(commitSummary(resp([success, success2, remote])).columnsWritten).toBe(3);
  });
});

describe("commitStatusMessage", () => {
  test("pluralizes and appends skipped count", () => {
    expect(commitStatusMessage({ writableCount: 1, failedCount: 0, columnsWritten: 1, allBlocked: false })).toBe(
      "wrote 1 column across 1 dataset",
    );
    expect(commitStatusMessage({ writableCount: 2, failedCount: 1, columnsWritten: 3, allBlocked: false })).toBe(
      "wrote 3 columns across 2 datasets, 1 skipped",
    );
  });
});
