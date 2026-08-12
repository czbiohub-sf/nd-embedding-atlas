import { describe, expect, test } from "bun:test";
import type { Coordinator } from "@uwdata/mosaic-core";

import {
  buildEntries,
  describeEntries,
  listColumns,
  type PlotEntry,
  VGPLOT_DEFAULT_CONFIG,
  vgplotConfigSchema,
} from "./spec-schema";

/** Coordinator stub: only `query` is exercised by `listColumns`. */
function stubCoordinator(rows: { column_name: string; column_type: string }[]): Coordinator {
  return {
    query: async () => rows,
  } as unknown as Coordinator;
}

describe("vgplotConfigSchema", () => {
  test("the default config parses (registry conformance)", () => {
    expect(vgplotConfigSchema.safeParse(VGPLOT_DEFAULT_CONFIG).success).toBe(true);
  });

  test("an entry with neither mark nor select is rejected", () => {
    const result = vgplotConfigSchema.safeParse({ entries: [{ x: "col" }], attributes: {} });
    expect(result.success).toBe(false);
  });

  test("a non-string mark is rejected", () => {
    expect(vgplotConfigSchema.safeParse({ entries: [{ mark: 7 }], attributes: {} }).success).toBe(false);
  });

  test("an interactor entry needs only select", () => {
    expect(
      vgplotConfigSchema.safeParse({ entries: [{ select: "intervalX", as: "$brush" }], attributes: {} }).success,
    ).toBe(true);
  });

  test("arbitrary extra keys are accepted and survive the parse", () => {
    const entry = {
      mark: "rectY",
      data: { from: "$table", filterBy: "$scope" },
      x: { bin: "col" },
      fill: "steelblue",
      nested: { deep: [1, "two", null, true] },
    };
    const result = vgplotConfigSchema.safeParse({ entries: [entry], attributes: { width: 400, grid: true } });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.entries[0]).toEqual(entry);
    expect(result.data.attributes).toEqual({ width: 400, grid: true });
  });

  test("attributes reject non-JSON values", () => {
    expect(vgplotConfigSchema.safeParse({ entries: [], attributes: { fn: () => 1 } }).success).toBe(false);
  });
});

describe("buildEntries", () => {
  test("histogram: rectY mark precedes its intervalX interactor", () => {
    const entries = buildEntries("histogram", "col");

    expect(entries).toHaveLength(2);
    expect(entries[0].mark).toBe("rectY");
    expect(entries[1].select).toBe("intervalX");

    expect(entries[0]).toEqual({
      mark: "rectY",
      data: { from: "$table", filterBy: "$scope" },
      x: { bin: "col" },
      y: { count: [] },
    });
    expect(entries[1]).toEqual({ select: "intervalX", as: "$brush", field: "col" });
  });

  test("count: barY mark precedes its toggleX interactor", () => {
    const entries = buildEntries("count", "col");

    expect(entries).toHaveLength(2);
    expect(entries[0].mark).toBe("barY");
    expect(entries[1].select).toBe("toggleX");

    expect(entries[0]).toEqual({
      mark: "barY",
      data: { from: "$table", filterBy: "$scope" },
      x: "col",
      y: { count: [] },
    });
    expect(entries[1]).toEqual({ select: "toggleX", as: "$brush" });
  });

  test("every preset's entries parse as config", () => {
    for (const preset of ["histogram", "count"] as const) {
      const config = { entries: buildEntries(preset, "col"), attributes: {} };
      expect(vgplotConfigSchema.safeParse(config).success).toBe(true);
    }
  });

  test("mark data is not shared between calls", () => {
    const a = buildEntries("count", "a");
    const b = buildEntries("count", "b");
    expect(a[0].data).not.toBe(b[0].data);
  });
});

describe("describeEntries", () => {
  test("round-trips both presets", () => {
    expect(describeEntries(buildEntries("histogram", "sepal_length"))).toEqual({
      preset: "histogram",
      field: "sepal_length",
    });
    expect(describeEntries(buildEntries("count", "species"))).toEqual({ preset: "count", field: "species" });
  });

  test("empty or unrecognized entries yield null", () => {
    expect(describeEntries([])).toBeNull();
    expect(describeEntries([{ mark: "dot", x: "a" }])).toBeNull();
    expect(describeEntries([{ select: "intervalX", as: "$brush" }])).toBeNull();
  });

  test("accepts the array form of a bin argument", () => {
    const entries: PlotEntry[] = [{ mark: "rectY", x: { bin: ["col"] } }];
    expect(describeEntries(entries)).toEqual({ preset: "histogram", field: "col" });
  });
});

describe("listColumns", () => {
  test("maps DuckDB types to column kinds", async () => {
    const columns = await listColumns(
      stubCoordinator([
        { column_name: "n_int", column_type: "INTEGER" },
        { column_name: "n_big", column_type: "BIGINT" },
        { column_name: "n_dbl", column_type: "DOUBLE" },
        { column_name: "n_dec", column_type: "DECIMAL(18,3)" },
        { column_name: "s_var", column_type: "VARCHAR" },
        { column_name: "s_enum", column_type: "ENUM('a','b')" },
        { column_name: "b_flag", column_type: "BOOLEAN" },
        { column_name: "t_ts", column_type: "TIMESTAMP" },
        { column_name: "l_list", column_type: "FLOAT[]" },
      ]),
    );

    expect([...columns]).toEqual([
      ["n_int", "number"],
      ["n_big", "number"],
      ["n_dbl", "number"],
      ["n_dec", "number"],
      ["s_var", "string"],
      ["s_enum", "string"],
      ["b_flag", "boolean"],
      ["t_ts", "other"],
      ["l_list", "number"],
    ]);
  });

  test("omits __row_index__", async () => {
    const columns = await listColumns(
      stubCoordinator([
        { column_name: "__row_index__", column_type: "BIGINT" },
        { column_name: "keep", column_type: "VARCHAR" },
      ]),
    );

    expect(columns.has("__row_index__")).toBe(false);
    expect([...columns.keys()]).toEqual(["keep"]);
  });

  test("lowercase type strings are matched case-insensitively", async () => {
    const columns = await listColumns(stubCoordinator([{ column_name: "c", column_type: "varchar" }]));
    expect(columns.get("c")).toBe("string");
  });
});
