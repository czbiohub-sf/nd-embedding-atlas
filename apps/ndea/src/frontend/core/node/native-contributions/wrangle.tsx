/** wrangle: a PRQL-authored predicate transform. */

import { andGraphPredicate, nodeConfig } from "@/core/graph/cook";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";
import { PrqlEditor } from "@/components/node-workspace/PrqlEditor";
import { createWrangleDefinition, type WrangleConfig } from "@ndea/nodes/wrangle";

const wrangleDefinition = createWrangleDefinition({
  mountBody: mountNodeBody,
  Editor: PrqlEditor,
});

export const wrangleNode = defineNativeNodeContribution({
  definition: wrangleDefinition,
  graph: {
    role: "transform",
    evaluationRole: "transform",
    cook: (inputs, host) => andGraphPredicate(inputs, nodeConfig<WrangleConfig>(host.node()).predicateSql ?? null),
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 280, h: 168 }, full: { w: 320, h: 280 }, canFull: true },
    stage: "pin-only",
    inPalette: true,
    body: "card-and-full",
  },
});
