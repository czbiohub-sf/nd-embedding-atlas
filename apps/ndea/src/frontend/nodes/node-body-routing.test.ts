import { describe, expect, test } from "bun:test";

import { countQuery } from "@/nodes/utils/count/query";
import { patchDatasetKey } from "@/nodes/utils/dataset/config-actions";
import { classifyWrangleSql } from "@/nodes/utils/wrangle/prql";

describe("node Body host routing", () => {
  test("Dataset switching patches only node config", () => {
    const patches: unknown[] = [];
    const host = { patchConfig: (patch: unknown) => patches.push(patch) };

    expect(patchDatasetKey(host, "plate-b")).toBe("plate-b");
    expect(patchDatasetKey(host, "")).toBe("");
    expect(patches).toEqual([{ datasetKey: "plate-b" }, { datasetKey: null }]);
  });

  test("Count query independently scopes all rows and a cooked predicate", () => {
    expect(countQuery("dataset", null)).toBe("SELECT COUNT(*)::INT AS n FROM dataset");
    expect(countQuery("dataset", '"score" > 2')).toBe('SELECT COUNT(*)::INT AS n FROM dataset WHERE "score" > 2');
  });

  test("Wrangle classification queries through the data capability", async () => {
    const calls: string[] = [];
    const filter = await classifyWrangleSql((sql) => {
      calls.push(sql);
      return Promise.resolve([{ column_name: "__obs_index__" }, { column_name: "score" }]);
    }, "SELECT * FROM dataset");
    const reshape = await classifyWrangleSql(
      () => Promise.resolve([{ column_name: "mean_score" }]),
      "SELECT AVG(score) AS mean_score FROM dataset",
    );
    const invalid = await classifyWrangleSql(
      () => Promise.reject(new Error("Binder Error: missing_column does not exist\nLINE 1")),
      "SELECT missing_column FROM dataset",
    );

    expect(calls).toEqual(["DESCRIBE (SELECT * FROM dataset)"]);
    expect(filter).toBe("filter");
    expect(reshape).toBe("reshaping");
    expect(invalid).toEqual({ error: "missing_column does not exist" });
  });
});
