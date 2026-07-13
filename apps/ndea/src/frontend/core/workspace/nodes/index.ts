/** Idempotent registration of every built-in workspace node. */

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
  // Keep persisted "selection" nodes readable without offering them in the palette.
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
