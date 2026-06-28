/**
 * annotate — plugin-backed terminal view (the `annotate` descriptor renders the
 * body). A labeling cursor over a working set: consumes the upstream predicate
 * (pred passthrough cook) as its iteration domain, and emits a `focus` out the
 * push port (the obs under the cursor) so wired viewers — Idetik (`fov`) and
 * Gallery — follow it, exactly as a Table row focus does. The focus rides
 * PUSH_PORT via `host.highlight.set`; the cook still carries the pred so the
 * batch path keeps a scope to stamp.
 */

import { defineWsNode, passthrough } from "@/core/workspace/node-kit";

export const annotateNode = defineWsNode({
  id: "annotate",
  type: "annotate",
  title: "Annotate",
  kind: "view",
  pluginId: "annotate",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "focus", label: "Focus" }],
  engineKind: "view",
  cook: (inputs) => passthrough(inputs),
  geometry: { chipW: 148, card: { w: 256, h: 180 }, full: { w: 320, h: 360 }, canFull: true },
  stage: "stageable",
  inPalette: true,
});
