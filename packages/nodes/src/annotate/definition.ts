/**
 * Annotate view descriptor (annotation spike: the node-graph batch "door").
 *
 * A TERMINAL `view` node (not a transform): it consumes the upstream predicate :
 * the engine sink delivers it into `host.inputPredicate`, exactly as Table/Gallery
 * receive their filter: as the iteration domain for labeling, and emits a `focus`
 * (cursor) out the push port so viewers follow. Two doors: batch (stamp the scope)
 * and cursor (label obs-by-obs). View, not transform, because the workspace only
 * renders a plugin Component as a node body for `kind: "view"` (body-dock.tsx);
 * transform-plugin bodies don't render yet. Chain continues by branching upstream.
 */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { createElement } from "react";
import type { NodeBodyMounter, NodeBodyProps } from "../contracts";
import type { AnnotateCapabilities, AnnotateConfig } from "./contracts";
import type { AnnotateServices } from "./services";

const CAPABILITIES = ["data-read", "annotation-write", "focus-coordination"] as const;

export function createAnnotateDefinition({
  mountBody,
  useServices,
}: {
  mountBody: NodeBodyMounter;
  useServices: () => AnnotateServices;
}) {
  return defineNode({
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
      function ConfiguredAnnotateView(props: NodeBodyProps<AnnotateConfig, AnnotateCapabilities>) {
        return createElement(AnnotateView, { ...props, services: useServices() });
      }
      return {
        mountBody: (host) => mountBody(ConfiguredAnnotateView, host, "Annotate"),
      };
    },
  });
}
