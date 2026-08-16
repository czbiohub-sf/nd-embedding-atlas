import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import type { NodeBodyMounter } from "../contracts";
import type { ThresholdFilterConfig, TransformFilterColumnTypesService } from "./contracts";

const CAPABILITIES = ["data-read", "compute"] as const;

export function createTransformFilterDefinition({
  mountBody,
  getColumnTypes,
}: {
  mountBody: NodeBodyMounter;
  getColumnTypes: TransformFilterColumnTypesService;
}) {
  return defineNode({
    ref: exactNodeTypeRef("transform-filter", "1.0.0"),
    title: "Threshold Filter",
    role: "transform",
    inputs: [{ id: "filter-in", kind: "pred", label: "In" }],
    outputs: [{ id: "out", kind: "pred", label: "Out" }],
    capabilities: CAPABILITIES,
    config: {
      schema: z.object({ column: z.string().nullable(), threshold: z.number() }),
      version: nodeConfigVersion(1),
      defaultValue: { column: null, threshold: 0 } satisfies ThresholdFilterConfig,
    },
    presentation: { icon: "filter" },
    documentation: {
      summary: "Keeps only the cells whose value clears a threshold.",
      use: "Use it to narrow the data before it flows to the next node.",
      note: "Set the column and cutoff in the node's options.",
    },
    load: async () => {
      // NodeDefinition.load is the intentional lazy plugin-module boundary.
      const { createThresholdFilterView } = await import("./view");
      const ThresholdFilterView = createThresholdFilterView(getColumnTypes);
      return {
        mountBody: (host) => mountBody(ThresholdFilterView, host, "Threshold Filter"),
      };
    },
  });
}
