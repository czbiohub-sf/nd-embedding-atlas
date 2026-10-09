/**
 * fov-score: tune the desirability model that ranks fields of view, and export it as the
 * yaml shrimPy ingests.
 *
 * Sink (no out port). It consumes a pred so it sits in the graph like the other views, but
 * the body deliberately reads the WHOLE feature matrix rather than the cooked predicate:
 * tuning a score function against human labels is a whole-dataset activity, and scoring a
 * crossfiltered subset would make the accuracy readout depend on whatever happened to be
 * lassoed in another panel.
 *
 * No app-owned services: everything it needs (metadata, coordinator, config) is on the host.
 */

import { createFovScoreDefinition } from "@ndea/nodes/fov-score";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { lastPortValueOfKind, passthroughGraphPredicate } from "@/core/graph/cook";
import { mountNodeBody } from "@/core/node/react-node-body";

export const fovScoreDefinition = createFovScoreDefinition({ mountBody: mountNodeBody });

export const fovScoreNode = defineNativeNodeContribution({
  definition: fovScoreDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => lastPortValueOfKind(inputs, "sel") ?? passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 132, card: { w: 260, h: 160 }, full: { w: 760, h: 520 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
