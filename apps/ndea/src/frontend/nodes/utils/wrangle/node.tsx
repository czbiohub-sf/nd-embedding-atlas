/** wrangle — a PRQL-authored predicate transform. */

import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { z } from "zod";

import { andGraphPredicate, nodeConfig } from "@/core/graph/cook";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { mountReactNodeBody } from "@/core/node/react-node-body";

export interface WrangleConfig {
  prql?: string;
  predicateSql?: string | null;
}

const CAPABILITIES = ["data-read"] as const;
export type WrangleCapabilities = (typeof CAPABILITIES)[number];

const wrangleDefinition = defineNode({
  ref: exactNodeTypeRef("wrangle", "1.0.0"),
  title: "Wrangle",
  role: "transform",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: CAPABILITIES,
  config: {
    schema: z.object({ prql: z.string().optional(), predicateSql: z.string().nullable().optional() }),
    version: nodeConfigVersion(1),
    defaultValue: {},
  },
  load: async () => {
    // NodeDefinition.load is the intentional lazy plugin-module boundary.
    const { WrangleBody } = await import("./body");
    return { mountBody: (host) => mountReactNodeBody(WrangleBody, host, "Wrangle") };
  },
});

export const wrangleNode = defineNativeNodeContribution({
  definition: wrangleDefinition,
  graph: {
    role: "transform",
    evaluationRole: "transform",
    cook: (inputs, host) => andGraphPredicate(inputs, nodeConfig<WrangleConfig>(host.node()).predicateSql ?? null),
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 280, h: 168 }, full: { w: 320, h: 280 }, canFull: true },
    stage: "pin-only",
    inPalette: true,
    body: "card-and-full",
  },
});
