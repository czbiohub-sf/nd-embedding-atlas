/**
 * Plugin barrel (PLUGIN-ARCHITECTURE §8). Importing this registers every
 * plugin's EAGER metadata. Engine code (TypeGPU, Idetik, ochre, roaring-wasm)
 * stays out of the boot graph — each descriptor's Component is behind a lazy
 * `load() => import()` chunk, so opening only a table never pays for scatter.
 *
 * `registerDescriptors()` is idempotent across HMR (the registry throws on a true
 * duplicate id, but module caching means this body runs once per id).
 *
 * Two phases: (0) the static in-tree barrel; (1) `discoverRuntimeDescriptors()`, an
 * INERT seam for user-authored plugins loaded from a directory at runtime — a
 * no-op until the Phase-2 loader + a `/api/plugin-manifest` exist. Wiring it now
 * keeps the boot path stable when runtime loading lands.
 */

import { registerDescriptor } from "@/core/node/registry";
import { annotateDescriptor } from "@/nodes/annotate/plugin";
import { countPlotDescriptor } from "@/nodes/charts/count-plot/plugin";
import { histogramDescriptor } from "@/nodes/charts/histogram/plugin";
import { galleryDescriptor } from "@/nodes/gallery/plugin";
import { imageViewerDescriptor } from "@/nodes/image-viewer/plugin";
import { scatterDescriptor } from "@/nodes/scatter/plugin";
import { tableDescriptor } from "@/nodes/table/plugin";
import { transformFilterDescriptor } from "@/nodes/transform-filter/plugin";

let registered = false;

export function registerDescriptors(): void {
  if (registered) return;
  registered = true;

  // Phase 0 — static in-tree plugins. Built-ins register FIRST so they own their
  // ids before any runtime plugin is discovered (deterministic precedence).
  registerDescriptor(scatterDescriptor);
  registerDescriptor(tableDescriptor);
  registerDescriptor(imageViewerDescriptor);
  registerDescriptor(countPlotDescriptor);
  registerDescriptor(histogramDescriptor);
  registerDescriptor(galleryDescriptor);
  registerDescriptor(transformFilterDescriptor);
  registerDescriptor(annotateDescriptor);

  // Phase 1 — runtime-discovered user plugins (inert until Phase 2).
  discoverRuntimeDescriptors();
}

/**
 * INERT runtime-plugin discovery seam (Phase 2). Will fetch a server-emitted
 * `/api/plugin-manifest`, dynamic-`import()` each user chunk, and feed its
 * descriptor through `tryRegisterExternalDescriptor` (built-ins / already-loaded win,
 * `sdkVersion`-gated — never throws). Returns immediately today: no loader and no
 * manifest endpoint exist yet, so nothing is discovered.
 */
function discoverRuntimeDescriptors(): void {
  // No-op until Phase 2 (loader + `/api/plugin-manifest`).
  return;
}
