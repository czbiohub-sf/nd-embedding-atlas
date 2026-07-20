/**
 * deriveDataCapabilities: the §3.1 metadata-facts → flat capability vocabulary
 * mapping (CAPABILITY-CONTRACT.md). Pure function, no fixture needed.
 */

import { describe, expect, test } from "bun:test";
import { deriveDataCapabilities, type CapabilityInputs } from "../capabilities.ts";

const EMPTY: CapabilityInputs = {
  hasObs: false,
  varCount: undefined,
  obsmKeys: [],
  hasSpatialXY: false,
  hasPlate: false,
  isMultimodal: false,
};

describe("deriveDataCapabilities", () => {
  test("empty inputs → no capabilities", () => {
    expect(deriveDataCapabilities(EMPTY)).toEqual([]);
  });

  test("obs derives from a non-empty obs dataframe", () => {
    expect(deriveDataCapabilities({ ...EMPTY, hasObs: true })).toEqual(["obs"]);
  });

  test("var derives from a scalar var_count", () => {
    expect(deriveDataCapabilities({ ...EMPTY, varCount: 2000 })).toContain("var");
    expect(deriveDataCapabilities({ ...EMPTY, varCount: 0 })).not.toContain("var");
  });

  test("var derives from any positive per-modality var_count (MuData)", () => {
    expect(deriveDataCapabilities({ ...EMPTY, varCount: { rna: 0, protein: 30 } })).toContain("var");
    expect(deriveDataCapabilities({ ...EMPTY, varCount: { rna: 0, protein: 0 } })).not.toContain("var");
  });

  test("obsm derives from registered embedding keys", () => {
    expect(deriveDataCapabilities({ ...EMPTY, obsmKeys: ["X_umap"] })).toContain("obsm");
    expect(deriveDataCapabilities({ ...EMPTY, obsmKeys: [] })).not.toContain("obsm");
  });

  test("spatial requires resolved x/y, not merely a null-filled spatial block", () => {
    expect(deriveDataCapabilities({ ...EMPTY, hasSpatialXY: true })).toContain("spatial");
    expect(deriveDataCapabilities({ ...EMPTY, hasSpatialXY: false })).not.toContain("spatial");
  });

  test("plate-image derives from a mounted HCS plate", () => {
    expect(deriveDataCapabilities({ ...EMPTY, hasPlate: true })).toContain("plate-image");
  });

  test("multimodal derives from MuData", () => {
    expect(deriveDataCapabilities({ ...EMPTY, isMultimodal: true })).toContain("multimodal");
  });

  test("obsp / temporal are reserved: never emitted today", () => {
    const all = deriveDataCapabilities({
      hasObs: true,
      varCount: 100,
      obsmKeys: ["X_umap"],
      hasSpatialXY: true,
      hasPlate: true,
      isMultimodal: true,
    });
    expect(all).not.toContain("obsp");
    expect(all).not.toContain("temporal");
  });

  test("a fully-featured MuData dataset derives the expected set", () => {
    const caps = deriveDataCapabilities({
      hasObs: true,
      varCount: { rna: 2000, protein: 30 },
      obsmKeys: ["rna:X_umap", "X_phate"],
      hasSpatialXY: true,
      hasPlate: true,
      isMultimodal: true,
    });
    expect(new Set(caps)).toEqual(new Set(["obs", "var", "obsm", "spatial", "plate-image", "multimodal"]));
  });
});
