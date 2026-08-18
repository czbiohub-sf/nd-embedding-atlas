/**
 * Carousel view descriptor: compare one subject across a variant axis.
 *
 * A TERMINAL `view` node with the same wiring shape as Annotate — it consumes the
 * upstream predicate through `host.inputPredicate` and emits a `focus` so wired
 * viewers follow the visible slide. The difference is what it iterates: Annotate
 * walks obs one at a time, while Carousel expands the FOCUSED obs into its peer
 * group (every obs sharing `groupBy`) and slides across them along `variantBy`.
 *
 * For the regularizer sweep that means one FOV rendered at 25 strengths, all in
 * the same spatial frame, labelled good/bad slide by slide. The annotation write
 * path is literally Annotate's: both nodes call `useAnnotationWriter`.
 */

import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { createElement } from "react";
import type { NodeBodyMounter, NodeBodyProps } from "../contracts";
import type { CarouselCapabilities, CarouselConfig, CarouselServices } from "./contracts";

const CAPABILITIES = ["data-read", "annotation-write", "focus-coordination"] as const;

export function createCarouselDefinition({
  mountBody,
  useServices,
}: {
  mountBody: NodeBodyMounter;
  useServices: () => CarouselServices;
}) {
  return defineNode({
    ref: exactNodeTypeRef("carousel", "1.0.0"),
    title: "Carousel",
    role: "view",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [{ id: "out", kind: "focus", label: "Focus" }],
    capabilities: CAPABILITIES,
    config: {
      schema: z.object({
        groupBy: z.string().nullable(),
        variantBy: z.string().nullable(),
        column: z.string().nullable(),
        labels: z.array(z.string()),
        /** How many variants are on screen at once. The point of the node. */
        slidesPerView: z.number().int().min(1).max(7).optional(),
        /** Explicit shared-contrast choice; null follows the published-window default. */
        autoContrast: z.boolean().nullable().optional(),
      }),
      version: nodeConfigVersion(1),
      defaultValue: {
        groupBy: null,
        variantBy: null,
        column: null,
        labels: ["good", "bad"],
        slidesPerView: 3,
        autoContrast: null,
      } satisfies CarouselConfig,
    },
    presentation: { icon: "images" },
    documentation: {
      summary: "Compares one FOV across a variant axis, like a regularizer sweep.",
      use: "Pick a group and variant column, slide across the variants, and label each good or bad.",
    },
    load: async () => {
      // The lazy boundary keeps the body — and its Embla plus idetik machinery —
      // out of the startup graph.
      const { CarouselView } = await import("./view");
      function ConfiguredCarouselView(props: NodeBodyProps<CarouselConfig, CarouselCapabilities>) {
        return createElement(CarouselView, { ...props, services: useServices() });
      }
      return {
        mountBody: (host) => mountBody(ConfiguredCarouselView, host, "Carousel"),
      };
    },
  });
}
