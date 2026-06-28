/**
 * Tests for commitObsColumns — appends obs columns to a zarr store and reads
 * them back via zarrita, for both v2 and v3, asserting alignment + NA handling.
 *
 * anndata-read compatibility is proven separately by the end-to-end spike
 * (spike/); these guard the module's own logic against regression.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zarr from "zarrita";
import { BunFileStore } from "../bun-store.ts";
import { commitObsColumns, registerWriteCodec, vlenEncode } from "../write-obs.ts";
import { asMutable } from "../zarr-boundary.ts";

registerWriteCodec();
const E = new TextEncoder();

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

/** Minimal AnnData obs group (root + obs + _index) with N obs, in the given format. */
async function makeBase(format: "v2" | "v3", obsNames: string[]): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "ndea-writeobs-"));
  const store = new BunFileStore(dir);
  const n = obsNames.length;
  const dfAttrs = { "encoding-type": "dataframe", "encoding-version": "0.2.0", _index: "_index", "column-order": [] };

  if (format === "v3") {
    const g = (attrs: object) => E.encode(JSON.stringify({ zarr_format: 3, node_type: "group", attributes: attrs }));
    await store.set("/zarr.json", g({}));
    await store.set("/obs/zarr.json", g(dfAttrs));
    const loc = zarr.root(asMutable(store));
    const idx = await zarr.create(loc.resolve("/obs/_index"), {
      shape: [n],
      chunkShape: [n],
      dtype: "string",
      codecs: [{ name: "vlen-utf8", configuration: {} }],
      fillValue: "",
      attributes: { "encoding-type": "string-array", "encoding-version": "0.2.0" },
    } as never);
    await zarr.set(idx as never, null, { data: obsNames, shape: [n], stride: [1] } as never);
  } else {
    await store.set("/.zgroup", E.encode(JSON.stringify({ zarr_format: 2 })));
    await store.set("/.zattrs", E.encode("{}"));
    await store.set("/obs/.zgroup", E.encode(JSON.stringify({ zarr_format: 2 })));
    await store.set("/obs/.zattrs", E.encode(JSON.stringify(dfAttrs)));
    await store.set(
      "/obs/_index/.zarray",
      E.encode(
        JSON.stringify({
          shape: [n],
          chunks: [n],
          dtype: "|O",
          fill_value: "",
          filters: [{ id: "vlen-utf8" }],
          order: "C",
          dimension_separator: ".",
          compressor: null,
          zarr_format: 2,
        }),
      ),
    );
    await store.set(
      "/obs/_index/.zattrs",
      E.encode(JSON.stringify({ "encoding-type": "string-array", "encoding-version": "0.2.0" })),
    );
    await store.set("/obs/_index/0", vlenEncode(obsNames));
  }
  return dir;
}

async function readArray(root: string, key: string): Promise<unknown[]> {
  const arr = await zarr.open(zarr.root(asMutable(new BunFileStore(root))).resolve(key), { kind: "array" });
  const chunk = await zarr.get(arr, null);
  return Array.from(chunk.data as ArrayLike<unknown>);
}

async function readColumnOrder(root: string, format: "v2" | "v3"): Promise<string[]> {
  const store = new BunFileStore(root);
  const key = format === "v3" ? "/obs/zarr.json" : "/obs/.zattrs";
  const meta = JSON.parse(new TextDecoder().decode(await store.get(key)));
  return (format === "v3" ? meta.attributes : meta)["column-order"];
}

for (const format of ["v2", "v3"] as const) {
  describe(`commitObsColumns (${format})`, () => {
    const obsNames = Array.from({ length: 6 }, (_, i) => `cell_${i}`);

    test("partial categorical aligns by obs_name with -1 for unlabeled", async () => {
      const root = await makeBase(format, obsNames);
      // label only cells 0,2,4
      const values = new Map<string, string | null>([
        ["cell_0", "A"],
        ["cell_2", "B"],
        ["cell_4", "A"],
      ]);
      const report = await commitObsColumns(root, [{ name: "label", kind: "categorical", values }]);
      expect(report.format).toBe(format);
      expect(report.columns[0].nNonNull).toBe(3);

      const codes = (await readArray(root, "/obs/label/codes")).map(Number);
      const cats = (await readArray(root, "/obs/label/categories")).map(String);
      // cats sorted: ["A","B"] → A=0, B=1; unlabeled = -1
      expect(cats).toEqual(["A", "B"]);
      expect(codes).toEqual([0, -1, 1, -1, 0, -1]);
      expect(await readColumnOrder(root, format)).toContain("label");
    });

    test("float column writes NaN for unannotated obs", async () => {
      const root = await makeBase(format, obsNames);
      const values = new Map<string, number | null>([
        ["cell_1", 3.5],
        ["cell_3", -2],
      ]);
      await commitObsColumns(root, [{ name: "score", kind: "float", values }]);
      const vals = (await readArray(root, "/obs/score")).map(Number);
      expect(vals[1]).toBeCloseTo(3.5);
      expect(vals[3]).toBeCloseTo(-2);
      expect(Number.isNaN(vals[0])).toBe(true);
      expect(Number.isNaN(vals[5])).toBe(true);
    });

    test("dryRun reports without writing", async () => {
      const root = await makeBase(format, obsNames);
      const values = new Map<string, string | null>([["cell_0", "X"]]);
      const report = await commitObsColumns(root, [{ name: "dry", kind: "categorical", values }], { dryRun: true });
      expect(report.written).toBe(false);
      expect(report.columns[0].nNonNull).toBe(1);
      expect(await new BunFileStore(root).exists(`/obs/dry${format === "v3" ? "/zarr.json" : "/.zgroup"}`)).toBe(false);
      expect(await readColumnOrder(root, format)).not.toContain("dry");
    });
  });
}
