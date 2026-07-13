/**
 * Annotate view descriptor (annotation spike — the node-graph batch "door").
 *
 * A TERMINAL `view` node (not a transform): it consumes the upstream predicate —
 * the engine sink delivers it into `host.inputSelection`, exactly as Table/Gallery
 * receive their filter — as the iteration domain for labeling, and emits a `focus`
 * (cursor) out the push port so viewers follow. Two doors: batch (stamp the scope)
 * and cursor (label obs-by-obs). View, not transform, because the workspace only
 * renders a plugin Component as a node body for `kind: "view"` (body-dock.tsx);
 * transform-plugin bodies don't render yet. Chain continues by branching upstream.
 */

import { defineDescriptor, type NodeCapability } from "@ndea/sdk";
import type { AnnotateConfig, AnnotateOptions } from "./view";

declare module "@/core/node/registry-types" {
  interface NodeTypeMap {
    annotate: { config: AnnotateConfig; options: AnnotateOptions };
  }
}

const CAPABILITIES = new Set<NodeCapability>(["read", "annotate"]);

export const annotateDescriptor = defineDescriptor<AnnotateConfig, AnnotateOptions>({
  id: "annotate",
  title: "Annotate",
  kind: "view",
  inputs: [{ id: "filter-in", kind: "pred", label: "In" }],
  outputs: [],
  capabilities: CAPABILITIES,
  placement: { container: "docked" },
  instancePolicy: "multi",
  icon: "tag",
  load: async () => {
    const { AnnotateView } = await import("./view");
    return {
      Component: AnnotateView,
      defaultConfig: { column: null, labels: [] },
    };
  },
});
