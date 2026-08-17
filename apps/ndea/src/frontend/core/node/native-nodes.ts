import type { ExactNodeTypeRef, NodeDefinition } from "@ndea/sdk";
import { annotateNode } from "./native-contributions/annotate";
import { cacheNode } from "./native-contributions/cache";
import { countPlotNode } from "./native-contributions/count-plot";
import { countNode } from "./native-contributions/count";
import { datasetNode } from "./native-contributions/dataset";
import { galleryNode } from "./native-contributions/gallery";
import { histogramNode } from "./native-contributions/histogram";
import { imageViewerNode } from "./native-contributions/image-viewer";
import { obsNode } from "./native-contributions/obs";
import { proxyNode } from "./native-contributions/proxy";
import { scatterNode } from "./native-contributions/scatter";
import { subnetNode } from "./native-contributions/subnet";
import { tableNode } from "./native-contributions/table";
import { thresholdNode } from "./native-contributions/transform-filter";
import { vgplotNode } from "./native-contributions/vgplot";
import { wrangleNode } from "./native-contributions/wrangle";
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
