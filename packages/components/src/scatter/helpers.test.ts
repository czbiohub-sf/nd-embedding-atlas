import { expect, test } from "bun:test";
import { dimLabel } from "./helpers";

test("dimLabel names known embeddings and keeps others as is", () => {
  expect(dimLabel("X_umap", 0)).toBe("UMAP1");
  expect(dimLabel("rna:X_pca", 1)).toBe("PC2");
  expect(dimLabel("X_tSNE", 2)).toBe("tSNE3");
  expect(dimLabel("X_phate", 0)).toBe("PHATE1");
  expect(dimLabel("X_dinov2", 0)).toBe("dinov2 1");
});
