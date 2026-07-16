/**
 * annotate — plugin-backed terminal view (the `annotate` descriptor renders the
 * body). A labeling cursor over a working set: consumes the upstream predicate
 * (predicate pass-through cook) as its iteration domain, and emits a `focus` out the
 * push port (the obs under the cursor) so wired viewers — Image Viewer and
 * Gallery — follow it, exactly as a Table row focus does. The focus rides
 * authored graph output through the host; the cook still carries the pred so the
 * batch path keeps a scope to stamp.
 */

import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { passthroughGraphPredicate } from "@/core/graph/cook";
import { annotateDefinition } from "./plugin";

export const annotateNode = defineNativeNodeContribution({
  definition: annotateDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 256, h: 180 }, full: { w: 320, h: 360 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
