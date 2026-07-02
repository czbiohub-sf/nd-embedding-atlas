/**
 * write-back — terminal sink node that commits staged annotation columns into the
 * source AnnData `.obs` on disk. The plugin-backed body (`WriteBackView`) renders
 * the column-selection + dry-run + confirm panel. Takes a `pred` input purely for
 * preview scoping; the commit acts on the dataset's staged columns (grouped
 * server-side by `dataset_key`), never on an edge payload — so there is no output.
 */

import { defineWsNode, passthrough } from "@/core/workspace/node-kit";

export const writeBackNode = defineWsNode({
  id: "write-back",
  type: "write-back",
  title: "Write-back",
  kind: "view",
  pluginId: "write-back",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [],
  engineKind: "view",
  cook: (inputs) => passthrough(inputs),
  geometry: { chipW: 148, card: { w: 256, h: 220 }, full: { w: 320, h: 400 }, canFull: true },
  stage: "stageable",
  inPalette: true,
});
