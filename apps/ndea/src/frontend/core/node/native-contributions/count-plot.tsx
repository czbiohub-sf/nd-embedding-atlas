/**
 * count-plot: plugin-backed view node. Categorical bar chart; pred in, sel out.
 * Cooks as a predicate pass-through; its bar selection rides the push port (sel),
 * delivered downstream outside the cook (mirrors scatter).
 */

import { createCountPlotDefinition } from "@ndea/nodes";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { useColumnTypes, useMosaicClient } from "@ndea/nodes/query";
import { NATIVE_NODE_GRAPH } from "@/core/graph/native-graph";

export const countPlotDefinition = createCountPlotDefinition({
  mountBody: mountNodeBody,
  services: {
    useColumnTypes,
    useQuery: useMosaicClient,
  },
});

export const countPlotNode = defineNativeNodeContribution({
  definition: countPlotDefinition,
  graph: NATIVE_NODE_GRAPH["count-plot"],
  presentation: {
    geometry: { chipW: 132, card: { w: 220, h: 200 }, full: { w: 360, h: 340 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
