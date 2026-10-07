/** filter: a typed Mosaic-clause predicate transform; `/api/filter` compiles the same clause. */

import { createFilterDefinition, filterClauseSql, type FilterConfig } from "@ndea/nodes/filter";
import { andGraphPredicate, nodeConfig } from "@/core/graph/cook";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountNodeBody } from "@/core/node/react-node-body";

export const filterNode = defineNativeNodeContribution({
  definition: createFilterDefinition({ mountBody: mountNodeBody }),
  graph: {
    role: "transform",
    evaluationRole: "transform",
    cook: (inputs, host) => {
      const where = nodeConfig<FilterConfig>(host.node()).where;
      return andGraphPredicate(inputs, where ? filterClauseSql(where) : null);
    },
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 280, h: 168 }, full: { w: 320, h: 280 }, canFull: true },
    stage: "pin-only",
    inPalette: true,
    body: "card-and-full",
  },
});
