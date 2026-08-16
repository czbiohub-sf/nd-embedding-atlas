// Colormap operations as a tree-shakeable namespace. Import via
// `import { Cmap } from "@ndea/ochre"` and access ops as `Cmap.map`.
// GPU variants live at `@ndea/ochre/gpu`.

import type { Srgb } from "../color/types";
import type { ColorMap } from "./types";

/** Evaluate a colormap at `t ∈ [0, 1]`. Delegates to `cmap.map(t)`. */
export function map(cmap: ColorMap, t: number): Srgb {
  return cmap.map(t);
}

export { mapBatch, mapBatchFlat } from "./linear";
export { reverse, reverseLinear, reverseDiscrete, slice } from "./transform";
