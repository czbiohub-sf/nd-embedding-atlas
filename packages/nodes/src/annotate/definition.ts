/** Annotate view descriptor: batch labeling over the filter scope, cursor labeling via focus. */

import { z } from "zod";
import { defineNode, exactNodeTypeRef } from "@ndea/sdk";
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
    capabilities: CAPABILITIES,
    config: {
      schema: z.object({
        column: z.string().nullable(),
        labels: z.array(z.string()),
        mode: z.enum(["label", "range"]).optional(),
      }),
      defaultValue: { column: null, labels: [] } satisfies AnnotateConfig,
    },
    presentation: { icon: "tag" },
    documentation: {
      summary: "Labels rows by writing values into an annotation column.",
      use: "Pick a column and labels, then tag rows one at a time or in batches.",
    },
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
