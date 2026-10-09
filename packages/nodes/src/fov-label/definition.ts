/** fov-label plugin descriptor: eager metadata; the body is behind the lazy load(). */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import type { NodeBodyMounter } from "../contracts";
import type { FovLabelConfig, FovLabelServices } from "./contracts";

const CAPABILITIES = ["data-read", "spatial-data", "annotation-write", "focus-coordination"] as const;

export function createFovLabelDefinition({
  mountBody,
  useServices,
}: {
  mountBody: NodeBodyMounter;
  useServices: () => FovLabelServices;
}) {
  return defineNode({
    ref: exactNodeTypeRef("fov-label", "1.0.0"),
    title: "FOV Label",
    role: "view",
    // Takes an input for graph consistency, but the plate is drawn from the whole
    // dataset: dropping cells would destroy the geometry that makes it readable.
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [],
    capabilities: CAPABILITIES,
    dataRequirements: ["plate-image"],
    config: {
      schema: z.object({
        half: z.number().nullable().default(null),
        size: z.number().nullable().default(null),
        cellPx: z.number().nullable().default(null),
        layout: z.enum(["plate", "ranked"]).nullable().default(null),
        rankColumn: z.string().nullable().default(null),
        channel: z.number().nullable().default(null),
      }),
      version: nodeConfigVersion(1),
      defaultValue: {
        half: null,
        size: null,
        cellPx: null,
        layout: null,
        rankColumn: null,
        channel: null,
      } satisfies FovLabelConfig,
    },
    presentation: { icon: "tag" },
    load: async () => {
      const { createFovLabelView } = await import("./view");
      const FovLabelView = createFovLabelView(useServices);
      return { mountBody: (host) => mountBody(FovLabelView, host, "FOV Label") };
    },
  });
}
