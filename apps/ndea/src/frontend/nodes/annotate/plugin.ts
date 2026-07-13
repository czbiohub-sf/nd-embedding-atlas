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

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { mountReactNodeBody } from "@/core/node/react-node-body";
import type { AnnotateConfig } from "./view";

const CAPABILITIES = ["data-read", "annotation-write", "focus-coordination"] as const;
export type AnnotateCapabilities = (typeof CAPABILITIES)[number];

export const annotateDefinition = defineNode({
  ref: exactNodeTypeRef("annotate", "1.0.0"),
  title: "Annotate",
  role: "view",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "focus", label: "Focus" }],
  capabilities: CAPABILITIES,
  config: {
    schema: z.object({
      column: z.string().nullable(),
      labels: z.array(z.string()),
      mode: z.enum(["label", "range"]).optional(),
    }),
    version: nodeConfigVersion(1),
    defaultValue: { column: null, labels: [] } satisfies AnnotateConfig,
  },
  presentation: { icon: "tag" },
  load: async () => {
    const { AnnotateView } = await import("./view");
    return {
      mountBody: (host) => mountReactNodeBody(AnnotateView, host, "Annotate"),
    };
  },
});
