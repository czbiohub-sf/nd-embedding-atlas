import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { z } from "zod";
import type { NodeBodyMounter } from "../contracts";
import type { WrangleCapabilities, WrangleEditor, WrangleConfig } from "./contracts";
import { createWrangleBody } from "./body";

export function createWrangleDefinition({ mountBody, Editor }: { mountBody: NodeBodyMounter; Editor: WrangleEditor }) {
  return defineNode({
    ref: exactNodeTypeRef("wrangle", "1.0.0"),
    title: "Wrangle",
    role: "transform",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [{ id: "out", kind: "pred", label: "Out" }],
    capabilities: ["data-read"] satisfies readonly WrangleCapabilities[],
    config: {
      schema: z.object({ prql: z.string().optional(), predicateSql: z.string().nullable().optional() }),
      version: nodeConfigVersion(1),
      defaultValue: {} satisfies WrangleConfig,
    },
    load: async () => {
      // NodeDefinition.load is the intentional lazy plugin-module boundary.
      const WrangleBody = createWrangleBody(Editor);
      return { mountBody: (host) => mountBody(WrangleBody, host, "Wrangle") };
    },
  });
}
