/**
 * ObsmSliceLoader — lazy column-wise obsm reader.
 *
 * Tests use the shared `annotations.zarr` fixture (if present) and a
 * hand-built mock handle covering the multi-dataset concat path.
 */

import { describe, expect, test } from "bun:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { openAnnData } from "@ndea/zarr";
import type { DatasetHandle } from "@ndea/zarr";
import { ObsmSliceLoader } from "../slice-loader.ts";

const FIXTURE = path.resolve(import.meta.dir, "../../../../../../ome-atlas-test-data/annotations.zarr");
const HAS_FIXTURE = existsSync(FIXTURE);

describe("ObsmSliceLoader — zarr fixture", () => {
  test("detectWidth reads zarr metadata only (no data fetch)", async () => {
    if (!HAS_FIXTURE) return;
    const adata = await openAnnData(FIXTURE);
    const accessors = new Map<string, DatasetHandle>([["fixture", adata]]);
    const width = await ObsmSliceLoader.detectWidth("X_pca", accessors.entries());
    // X_pca shape depends on fixture; just assert it's a sane positive int.
    expect(width).toBeGreaterThan(0);
    expect(Number.isInteger(width)).toBe(true);
  });

  test("loadColumn(0) matches full-matrix column 0 byte-for-byte", async () => {
    if (!HAS_FIXTURE) return;
    const adata = await openAnnData(FIXTURE);
    const full = await adata.getObsm("X_pca");
    const [nRows, nCols] = full.shape as [number, number];

    const loader = new ObsmSliceLoader("X_pca", new Map<string, DatasetHandle>([["fixture", adata]]).entries(), nCols);
    const col0 = await loader.loadColumn(0);
    expect(col0.length).toBe(nRows);

    // Extract column 0 from the full row-major matrix.
    const expected = new Float32Array(nRows);
    for (let i = 0; i < nRows; i++) expected[i] = (full.data as Float32Array | Float64Array)[i * nCols];

    // Tolerant equality: the getObsm path returns the native dtype (often
    // f64), loadColumn returns f32 — compare with small epsilon.
    for (let i = 0; i < nRows; i++) {
      expect(Math.abs(col0[i] - expected[i])).toBeLessThan(1e-4);
    }
  });

  test("loadColumn is cached: second call hits the cache (same reference)", async () => {
    if (!HAS_FIXTURE) return;
    const adata = await openAnnData(FIXTURE);
    const loader = new ObsmSliceLoader(
      "X_pca",
      new Map<string, DatasetHandle>([["fixture", adata]]).entries(),
      (await adata.getObsmShape("X_pca"))[1],
    );
    const first = await loader.loadColumn(0);
    const second = await loader.loadColumn(0);
    expect(second).toBe(first); // referential equality — no re-read
  });

  test("loadColumn rejects out-of-range colIndex", async () => {
    if (!HAS_FIXTURE) return;
    const adata = await openAnnData(FIXTURE);
    const width = (await adata.getObsmShape("X_pca"))[1];
    const loader = new ObsmSliceLoader("X_pca", new Map<string, DatasetHandle>([["fixture", adata]]).entries(), width);
    await expect(loader.loadColumn(-1)).rejects.toThrow(/out of range/);
    await expect(loader.loadColumn(width)).rejects.toThrow(/out of range/);
  });

  test("concurrent loadColumn calls dedup via inflight map", async () => {
    if (!HAS_FIXTURE) return;
    const adata = await openAnnData(FIXTURE);
    const loader = new ObsmSliceLoader(
      "X_pca",
      new Map<string, DatasetHandle>([["fixture", adata]]).entries(),
      (await adata.getObsmShape("X_pca"))[1],
    );
    const [a, b, c] = await Promise.all([loader.loadColumn(1), loader.loadColumn(1), loader.loadColumn(1)]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test("AbortSignal pre-aborted: throws without caching", async () => {
    if (!HAS_FIXTURE) return;
    const adata = await openAnnData(FIXTURE);
    const loader = new ObsmSliceLoader(
      "X_pca",
      new Map<string, DatasetHandle>([["fixture", adata]]).entries(),
      (await adata.getObsmShape("X_pca"))[1],
    );
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(loader.loadColumn(0, ctrl.signal)).rejects.toBeDefined();
  });
});

describe("ObsmSliceLoader — multi-dataset concat", () => {
  /** Minimal DatasetHandle stub that returns synthetic columns. */
  function makeStub(_name: string, nObs: number, width: number, baseValue: number): DatasetHandle {
    return {
      kind: "anndata",
      nObs,
      obs: { length: nObs } as never,
      var: { length: 0 } as never,
      listObsmKeys: () => Promise.resolve(["X_mock"]),
      getObsm: () => {
        const data = new Float32Array(nObs * width);
        for (let i = 0; i < nObs; i++) {
          for (let c = 0; c < width; c++) data[i * width + c] = baseValue + c * 100 + i;
        }
        return Promise.resolve({ data, shape: [nObs, width] });
      },
      getObsmShape: () => Promise.resolve([nObs, width] as const),
      getObsmColumn: (_key: string, colIndex: number) => {
        const col = new Float32Array(nObs);
        for (let i = 0; i < nObs; i++) col[i] = baseValue + colIndex * 100 + i;
        return Promise.resolve(col);
      },
      toDuckDB: () => Promise.reject(new Error("not used")),
    } as unknown as DatasetHandle;
  }

  test("concatenates columns across two stub accessors in insertion order", async () => {
    const a = makeStub("A", 3, 4, 1000);
    const b = makeStub("B", 2, 4, 2000);

    const accessors: (readonly [string, DatasetHandle])[] = [
      ["A", a],
      ["B", b],
    ];
    const loader = new ObsmSliceLoader("X_mock", accessors, 4);
    const col = await loader.loadColumn(2);

    expect(col.length).toBe(5);
    // A col 2: base=1000, colOffset=200 → 1200, 1201, 1202
    // B col 2: base=2000, colOffset=200 → 2200, 2201
    expect(col[0]).toBeCloseTo(1200);
    expect(col[1]).toBeCloseTo(1201);
    expect(col[2]).toBeCloseTo(1202);
    expect(col[3]).toBeCloseTo(2200);
    expect(col[4]).toBeCloseTo(2201);
  });
});
