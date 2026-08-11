import type { ExactNodeTypeRef, NodeDefinition } from "@ndea/sdk";
import { annotateNode } from "@/nodes/annotate/node";
import { countPlotNode } from "@/nodes/charts/count-plot/node";
import { histogramNode } from "@/nodes/charts/histogram/node";
import { vgplotNode } from "@/nodes/charts/vgplot/node";
import { galleryNode } from "@/nodes/gallery/node";
import { imageViewerNode } from "@/nodes/image-viewer/node";
import { scatterNode } from "@/nodes/scatter/node";
import { tableNode } from "@/nodes/table/node";
import { thresholdNode } from "@/nodes/transform-filter/node";
import { cacheNode } from "@/nodes/utils/cache/node";
import { countNode } from "@/nodes/utils/count/node";
import { datasetNode } from "@/nodes/utils/dataset/node";
import { obsNode } from "@/nodes/utils/obs/node";
import { proxyNode } from "@/nodes/utils/proxy/node";
import { subnetNode } from "@/nodes/utils/subnet/node";
import { wrangleNode } from "@/nodes/utils/wrangle/node";
import type { AnyNativeNodeContribution } from "./native-contribution";

/**
 * The sole native-node inventory. Tuple order is the product order; filtering
 * this tuple is the only palette, boot, and fitness enumeration path.
 */
export const NATIVE_NODE_CONTRIBUTIONS = Object.freeze([
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
  vgplotNode,
  galleryNode,
  imageViewerNode,
  cacheNode,
  subnetNode,
  proxyNode,
] as const satisfies readonly AnyNativeNodeContribution[]);

// Heterogeneous immutable inventory: each definition retains its precise author
// type before this sole existential collection boundary.
// oxlint-disable-next-line no-explicit-any -- generic erasure is required for the mixed-config tuple.
export const NATIVE_NODE_DEFINITIONS: readonly NodeDefinition<any, any>[] = Object.freeze(
  NATIVE_NODE_CONTRIBUTIONS.map(({ definition }) => definition),
);

export const NATIVE_NODE_CURRENT_REFS: readonly ExactNodeTypeRef[] = Object.freeze(
  NATIVE_NODE_DEFINITIONS.map(({ ref }) => ref),
);
