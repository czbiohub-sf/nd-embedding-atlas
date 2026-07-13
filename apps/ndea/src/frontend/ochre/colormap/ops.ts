// Colormap operations as a tree-shakeable namespace. Import via
// `import { Cmap } from "@srivarra/ochre"` and access ops as `Cmap.map`.
//
// Each member is a named re-export, so bundlers drop unused ones. GPU
// variants live here too; importing `Cmap.map` on a CPU-only path won't
// pull TypeGPU in.

import type { Srgb } from "../color/types";
import type { ColorMap } from "./types";

/** Evaluate a colormap at `t ∈ [0, 1]`. Delegates to `cmap.map(t)`. */
export function map(cmap: ColorMap, t: number): Srgb {
  return cmap.map(t);
}

export { mapBatch, mapBatchFlat } from "./linear";
export { reverse, reverseLinear, reverseDiscrete, slice } from "./transform";

// GPU variants (tree-shaken when unused).
export { toGpuSrgb, toGpuLinearRgb, toGpuOkLab, toGpuOkLch } from "../gpu/linear-colormap";
