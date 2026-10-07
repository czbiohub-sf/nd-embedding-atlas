/**
 * table: plugin-backed view (the `table` descriptor renders the body). Cooks
 * as a predicate pass-through; its row focus rides the push port (focus), delivered
 * downstream outside the cook. Out port is `focus` (table row → image viewer).
 */

import { createTableDefinition } from "@ndea/nodes/table";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { requireAppNodeHostFacet } from "@/core/node/app-node-host";
import { NATIVE_NODE_GRAPH } from "@/core/graph/native-graph";

export const tableDefinition = createTableDefinition({
  mountBody: mountNodeBody,
  services: {
    bodyHeaderElement: (host) => requireAppNodeHostFacet(host, "bodyHeaderElement"),
  },
});

export const tableNode = defineNativeNodeContribution({
  definition: tableDefinition,
  graph: NATIVE_NODE_GRAPH["table"],
  presentation: {
    geometry: { chipW: 128, card: { w: 224, h: 128 }, full: { w: 460, h: 320 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
    requiredHostFacets: ["bodyHeaderElement"],
  },
});
