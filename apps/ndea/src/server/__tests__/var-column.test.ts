import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAnnData, type SparseArray } from "@ndea/zarr";
import { writeAnnData } from "../../../scripts/synthetic-anndata.ts";
import { loadVarSlice } from "../routes/var.ts";

const dir = await mkdtemp(join(tmpdir(), "ndea-var-column-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

test("a CSR gene column has the stored values at their rows and 0 elsewhere", async () => {
  // ~20 stored entries per row over 2000 vars: gene_5 is stored in a few rows only.
  const store = join(dir, "csr.zarr");
  await writeAnnData(store, { nObs: 300, nVars: 2000 });
  const adata = await openAnnData(store);
  const j = (adata.var.index as string[]).indexOf("gene_5");

  // Expected column, decoded straight from the full CSR arrays.
  const x = (await adata.getX()) as SparseArray;
  expect(x.format).toBe("csr");
  const expected = new Float64Array(adata.nObs);
  // int64 indptr decodes to a BigInt64Array at runtime.
  const indptr: ArrayLike<number | bigint> = x.indptr;
  for (let i = 0; i < adata.nObs; i++) {
    for (let p = Number(indptr[i]); p < Number(indptr[i + 1]); p++) {
      if (x.indices[p] === j) expected[i] = x.data[p];
    }
  }
  const stored = expected.filter((v) => v !== 0).length;
  expect(stored).toBeGreaterThan(0);
  expect(stored).toBeLessThan(adata.nObs);

  expect(await loadVarSlice(adata, j, "X", adata.nObs)).toEqual(expected);
});
