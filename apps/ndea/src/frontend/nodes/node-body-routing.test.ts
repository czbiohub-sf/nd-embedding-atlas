import { describe, expect, test } from "bun:test";
import type { Collection, CollectionMutationResult, CreateCollectionBody } from "@ndea/protocol";
import { rowIndex } from "@ndea/sdk";

import type { GraphNodeCookHost } from "@/core/graph/cook";
import { bindCollection } from "@/nodes/collection/config-actions";
import { countQuery } from "@/nodes/utils/count/query";
import { patchDatasetKey } from "@/nodes/utils/dataset/config-actions";
import { exportNode } from "@/nodes/utils/export/node";
import { saveExportCollection } from "@/nodes/utils/export/save";
import { classifyWrangleSql } from "@/nodes/utils/wrangle/prql";

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    collection_id: "keepers",
    name: "Keepers",
    color: null,
    notes: null,
    tags: [],
    provenance: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_count: 2,
    current_count: 2,
    drift: [],
    version: 7,
    ...overrides,
  };
}

describe("node Body host routing", () => {
  test("Dataset switching patches only node config", () => {
    const patches: unknown[] = [];
    const host = { patchConfig: (patch: unknown) => patches.push(patch) };

    expect(patchDatasetKey(host, "plate-b")).toBe("plate-b");
    expect(patchDatasetKey(host, "")).toBe("");
    expect(patches).toEqual([{ datasetKey: "plate-b" }, { datasetKey: null }]);
  });

  test("Collection bind and unbind patch only node config", () => {
    const patches: unknown[] = [];
    const host = { patchConfig: (patch: unknown) => patches.push(patch) };

    expect(bindCollection(host, collection())).toEqual({
      collectionId: "keepers",
      collectionName: "Keepers",
      collectionVersion: 7,
    });
    expect(bindCollection(host, null)).toEqual({
      collectionId: null,
      collectionName: null,
      collectionVersion: null,
    });
    expect(patches).toEqual([
      { collectionId: "keepers", collectionName: "Keepers", collectionVersion: 7 },
      { collectionId: null, collectionName: null, collectionVersion: null },
    ]);
  });

  test("Export saves the subscribed row set and patches the returned binding", async () => {
    const patches: unknown[] = [];
    const requests: CreateCollectionBody[] = [];
    const result: CollectionMutationResult = {
      result: collection({ collection_id: "saved", name: "Saved rows", version: 3 }),
      stats: { added: 2, already_member: 0, total: 2 },
    };

    await saveExportCollection(
      { patchConfig: (patch) => patches.push(patch) },
      "Saved rows",
      [rowIndex(11), rowIndex(12)],
      (body) => {
        requests.push(body);
        return Promise.resolve(result);
      },
    );

    expect(requests).toEqual([{ name: "Saved rows", tags: [], row_indices: [11, 12] }]);
    expect(patches).toEqual([{ collectionId: "saved", collectionName: "Saved rows", collectionVersion: 3 }]);
  });

  test("Export cook preserves pushed rows for the edge-bound host", () => {
    const rowSet = {
      kind: "sel" as const,
      sql: '"__row_index__" IN (11, 12)',
      rowIds: [rowIndex(11), rowIndex(12)],
    };
    const output = exportNode.graph.cook(new Map([["in-sel", [rowSet]]]), {} as GraphNodeCookHost);

    expect(output).toBe(rowSet);
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
