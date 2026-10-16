/** Annotate view descriptor: batch labeling over the filter scope, cursor labeling via focus. */

import { z } from "zod";
import { defineComponent } from "@ndea/sdk";
import { createElement } from "react";
import type { BodyMounter, BodyProps } from "../contracts";
import type { AnnotateConfig } from "./contracts";
import type { AnnotateServices } from "./services";

export function createAnnotateDefinition({
  mountBody,
  useServices,
}: {
  mountBody: BodyMounter;
  useServices: () => AnnotateServices;
}) {
  return defineComponent({
    type: "annotate",
    title: "Annotate",
    config: {
      schema: z.object({
        column: z.string().nullable(),
        labels: z.array(z.string()),
        mode: z.enum(["label", "range"]).optional(),
      }),
      defaultValue: { column: null, labels: [] } satisfies AnnotateConfig,
    },
    documentation: {
      summary: "Labels rows by writing values into an annotation column.",
      use: "Pick a column and labels, then tag rows one at a time or in batches.",
    },
    binds: ["focus", "filter"],
    load: async () => {
      const { AnnotateView } = await import("./view");
      function ConfiguredAnnotateView(props: BodyProps<AnnotateConfig>) {
        return createElement(AnnotateView, { ...props, services: useServices() });
      }
      return {
        mountBody: (host) => mountBody(ConfiguredAnnotateView, host, "Annotate"),
      };
    },
  });
}
