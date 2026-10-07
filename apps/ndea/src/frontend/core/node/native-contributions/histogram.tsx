/**
 * histogram: plugin-backed view node. Binned distribution of a numeric column;
 * pred in, sel out. Cooks as a predicate pass-through; its brush selection rides the
 * push port (sel), delivered downstream outside the cook (mirrors scatter).
 */

import { createHistogramDefinition } from "@ndea/nodes";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { useColumnTypes, useMosaicClient } from "@ndea/nodes/query";
import { NATIVE_NODE_GRAPH } from "@/core/graph/native-graph";

export const histogramDefinition = createHistogramDefinition({
  mountBody: mountNodeBody,
  services: {
    useColumnTypes,
    useQuery: useMosaicClient,
  },
});

export const histogramNode = defineNativeNodeContribution({
  definition: histogramDefinition,
  graph: NATIVE_NODE_GRAPH["histogram"],
  presentation: {
    geometry: { chipW: 132, card: { w: 240, h: 160 }, full: { w: 380, h: 300 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
