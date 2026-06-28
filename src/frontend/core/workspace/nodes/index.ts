/**
 * Built-in node registration — the workspace counterpart to `registerDescriptors()`.
 * Every workspace graph node (built-in source/transform/view AND the
 * plugin-backed views: scatter/table/gallery/fov/annotate/threshold) is a
 * self-registering `WsNodeSpec` in the shared SDK registry. `NODE_DEFS` is a
 * derived view over these specs; the cook + body switches are gone (registry
 * lookups). `registerBuiltinNodes()` is called once at boot (`main.tsx`) and is
 * idempotent so tests can call it freely.
 *
 * NB: a plugin-backed node spec (e.g. `scatterNode`) carries the canvas
 * geometry/flags + engine cook + `pluginId`; the matching `NodeDescriptor`
 * (registered by `registerDescriptors()`) still owns the lazy-loaded body Component.
 * The two are complementary: the spec is node identity, the descriptor is the
 * heavy body.
 */

import { getNode, registerNode } from "@/core/node/registry";
import { defineWsNode } from "../node-kit";
import { annotateNode } from "@/nodes/annotate/node";
import { cacheNode } from "@/nodes/utils/cache/node";
import { collectionNode } from "@/nodes/collection/node";
import { countNode } from "@/nodes/utils/count/node";
import { countPlotNode } from "@/nodes/charts/count-plot/node";
import { histogramNode } from "@/nodes/charts/histogram/node";
import { datasetNode } from "@/nodes/utils/dataset/node";
import { exportNode } from "@/nodes/utils/export/node";
import { fovNode } from "@/nodes/image-viewer/node";
import { galleryNode } from "@/nodes/gallery/node";
import { obsNode } from "@/nodes/utils/obs/node";
import { proxyNode } from "@/nodes/utils/proxy/node";
import { scatterNode } from "@/nodes/scatter/node";
import { subnetNode } from "@/nodes/utils/subnet/node";
import { tableNode } from "@/nodes/table/node";
import { thresholdNode } from "@/nodes/transform-filter/node";
import { wrangleNode } from "@/nodes/utils/wrangle/node";

let registered = false;

export function registerBuiltinNodes(): void {
  if (registered || getNode("obs")) {
    registered = true;
    return;
  }
  // Registration order = the legacy NODE_DEFS literal order, so the derived
  // PALETTE (filtered to inPalette, in registry order) is byte-for-byte stable.
  for (const spec of [
    obsNode,
    datasetNode,
    thresholdNode,
    wrangleNode,
    annotateNode,
    countNode,
    tableNode,
    scatterNode,
    countPlotNode,
    histogramNode,
    galleryNode,
    fovNode,
    collectionNode,
    exportNode,
    cacheNode,
    subnetNode,
    proxyNode,
  ]) {
    registerNode(spec);
  }
  // Deprecated alias: a persisted "selection" node cooks as a cache (same spec),
  // but is out of the palette (never created anew) — matches the legacy NodeDef.
  registerNode(
    defineWsNode({
      ...cacheNode,
      id: "selection",
      type: "selection",
      kind: "selection",
      title: "Selection",
      inPalette: false,
      // preserve the legacy Selection geometry (slightly smaller than cache).
      geometry: { chipW: 148, card: { w: 232, h: 164 }, full: { w: 232, h: 164 }, canFull: false },
    }),
  );
  registered = true;
}
