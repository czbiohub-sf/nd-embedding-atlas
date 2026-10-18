/**
 * AnnData / MuData / OME-Zarr opening: conventions and frame metadata.
 * obs/var values are read by DuckDB (apps/ndea server tests).
 *
 * Fixture: ../ome-atlas-test-data/annotations.zarr: small dense AnnData
 * (~8.3k obs × 768 var). Tests that need it are skipped if it is absent so CI
 * environments without the test-data checkout still pass.
 */

import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { BunFileStore, open, openAnnData, openMuData } from "../index.ts";
import { vlenEncode } from "../write-obs.ts";

const FIXTURE = path.resolve(import.meta.dir, "../../../../../ome-atlas-test-data/annotations.zarr");
const HAS_FIXTURE = existsSync(FIXTURE);
const TEXT_ENCODER = new TextEncoder();

let temporaryStorePath = "";
afterEach(async () => {
  if (temporaryStorePath) await rm(temporaryStorePath, { recursive: true, force: true });
  temporaryStorePath = "";
});

async function createV2Group(store: BunFileStore, groupPath: string, attrs: Record<string, unknown>): Promise<void> {
  const prefix = groupPath === "/" ? "" : groupPath;
  await store.set(`${prefix}/.zgroup`, TEXT_ENCODER.encode(JSON.stringify({ zarr_format: 2 })));
  await store.set(`${prefix}/.zattrs`, TEXT_ENCODER.encode(JSON.stringify(attrs)));
}

async function createV2StringIndex(store: BunFileStore, dataFramePath: string, names: string[]): Promise<void> {
  const indexPath = `${dataFramePath}/_index`;
  await store.set(
    `${indexPath}/.zarray`,
    TEXT_ENCODER.encode(
      JSON.stringify({
        shape: [names.length],
        chunks: [names.length],
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
    `${indexPath}/.zattrs`,
    TEXT_ENCODER.encode(JSON.stringify({ "encoding-type": "string-array", "encoding-version": "0.2.0" })),
  );
  await store.set(`${indexPath}/0`, vlenEncode(names));
}

async function createV2DataFrame(store: BunFileStore, dataFramePath: string, names: string[]): Promise<void> {
  await createV2Group(store, dataFramePath, {
    "encoding-type": "dataframe",
    "encoding-version": "0.2.0",
    _index: "_index",
    "column-order": [],
  });
  await createV2StringIndex(store, dataFramePath, names);
}

async function createMuDataFixture(): Promise<BunFileStore> {
  temporaryStorePath = await mkdtemp(path.join(tmpdir(), "ndea-mudata-"));
  const store = new BunFileStore(temporaryStorePath);
  await createV2Group(store, "/", {
    "encoding-type": "MuData",
    "encoding-version": "0.1.0",
    axis: 0,
  });
  await createV2DataFrame(store, "/obs", ["cell_0", "cell_1"]);
  await createV2DataFrame(store, "/var", ["shared_feature"]);
  await createV2Group(store, "/mod", {});
  await createV2Group(store, "/mod/rna", {
    "encoding-type": "anndata",
    "encoding-version": "0.1.0",
  });
  await createV2DataFrame(store, "/mod/rna/obs", ["cell_0", "cell_1"]);
  await createV2DataFrame(store, "/mod/rna/var", ["gene_0", "gene_1"]);
  await createV2Group(store, "/obsmap", {});
  await store.set(
    "/obsmap/rna/.zarray",
    TEXT_ENCODER.encode(
      JSON.stringify({
        shape: [2],
        chunks: [2],
        dtype: "<i4",
        fill_value: 0,
        filters: null,
        order: "C",
        dimension_separator: ".",
        compressor: null,
        zarr_format: 2,
      }),
    ),
  );
  await store.set(
    "/obsmap/rna/.zattrs",
    TEXT_ENCODER.encode(JSON.stringify({ "encoding-type": "array", "encoding-version": "0.2.0" })),
  );
  await store.set("/obsmap/rna/0", new Uint8Array(new Int32Array([0, 1]).buffer));
  return store;
}

async function createOmeZarrFixture() {
  temporaryStorePath = await mkdtemp(path.join(tmpdir(), "ndea-ome-zarr-"));
  const store = new BunFileStore(temporaryStorePath);
  const attrs = {
    multiscales: [
      {
        version: "0.4",
        axes: [
          { name: "t", type: "time" },
          { name: "c", type: "channel" },
          { name: "z", type: "space" },
          { name: "y", type: "space" },
          { name: "x", type: "space" },
        ],
        datasets: [{ path: "0" }],
      },
    ],
    omero: { channels: [{ label: "DAPI" }] },
  };
  await createV2Group(store, "/", attrs);
  return { store, attrs };
}

describe("BunFileStore", () => {
  test("normalizes only trailing path separators", () => {
    expect(new BunFileStore("/tmp/data///").root).toBe("/tmp/data");
    expect(new BunFileStore("/tmp////data").root).toBe("/tmp////data");
    expect(new BunFileStore("/").root).toBe("");
  });

  test("resolves keys under root and returns undefined for missing files", async () => {
    if (!HAS_FIXTURE) return;
    const store = new BunFileStore(FIXTURE);
    // v2 fixture; v3 stores use zarr.json. Probe both so the test is format-agnostic.
    const v2 = await store.get("/.zgroup");
    const v3 = await store.get("/zarr.json");
    const missing = await store.get("/this/does/not/exist");
    const present = v2 ?? v3;
    expect(present).toBeDefined();
    expect((present as Uint8Array).byteLength).toBeGreaterThan(0);
    expect(missing).toBeUndefined();
  });

  test("getRange reads a byte slice", async () => {
    if (!HAS_FIXTURE) return;
    const store = new BunFileStore(FIXTURE);
    const key = (await store.exists("/.zgroup")) ? "/.zgroup" : "/zarr.json";
    const bytes = await store.getRange(key, { offset: 0, length: 8 });
    expect(bytes?.byteLength).toBe(8);
  });
});

describe("Zarr convention vocabulary through the package barrel", () => {
  test("MuData retains its discriminant, axis, modality key, and frame metadata", async () => {
    const store = await createMuDataFixture();
    const parsed = await open(store);

    expect(parsed.kind).toBe("mudata");
    if (parsed.kind !== "mudata") throw new Error(`Expected MuData, received ${parsed.kind}`);
    expect(parsed.attrs).toMatchObject({
      "encoding-type": "MuData",
      "encoding-version": "0.1.0",
      axis: 0,
    });
    expect([...parsed.modalities.keys()]).toEqual(["rna"]);

    const mdata = await openMuData(store);
    expect(mdata.kind).toBe("mudata");
    expect(mdata.axis).toBe(0);
    expect(mdata.modNames).toEqual(["rna"]);
    expect(mdata.obs).toEqual({ indexName: "_index", columns: [], encodings: {}, length: 2 });
    expect(mdata.var.length).toBe(1);
    expect(mdata.mod.get("rna")?.groupPath).toBe("mod/rna");
    expect(mdata.mod.get("rna")?.obs.length).toBe(2);
    expect(mdata.mod.get("rna")?.var.length).toBe(2);
  });

  test("OME-Zarr retains its discriminant, TCZYX axes, and metadata attributes", async () => {
    const { store, attrs } = await createOmeZarrFixture();
    const parsed = await open(store);

    expect(parsed.kind).toBe("ome-zarr");
    if (parsed.kind !== "ome-zarr") throw new Error(`Expected OME-Zarr, received ${parsed.kind}`);
    expect(parsed.attrs).toEqual(attrs);
    expect(parsed.multiscales).toEqual(attrs.multiscales);
    const axes = (parsed.multiscales[0] as { axes: { name: string }[] }).axes.map(({ name }) => name);
    expect(axes).toEqual(["t", "c", "z", "y", "x"]);
  });
});

describe("AnnData class: obs/var frame metadata", () => {
  test("opens fixture, exposes obs/var metadata with correct shape", async () => {
    if (!HAS_FIXTURE) return;
    const adata = await openAnnData(FIXTURE);
    expect(adata.nObs).toBeGreaterThan(0);
    expect(adata.nVars).toBeGreaterThan(0);
    expect(adata.obs.length).toBe(adata.nObs);
    expect(adata.var.length).toBe(adata.nVars);
    expect(adata.obs.columns.length).toBeGreaterThan(0);
    expect(Object.keys(adata.obs.encodings).toSorted()).toEqual([...adata.obs.columns].toSorted());
    expect(adata.shape).toEqual([adata.nObs, adata.nVars]);
    expect(adata.source).toBe(FIXTURE);
    expect(await adata.matrixFormat("X")).toBe("dense");
  });
});
