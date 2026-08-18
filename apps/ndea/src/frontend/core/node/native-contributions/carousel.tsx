/**
 * carousel: app-owned graph and canvas policy for the comparison carousel.
 *
 * A terminal view like Annotate: it consumes the upstream predicate as its
 * iteration domain and re-emits the AND of its inputs downstream, so a chain can
 * continue past it. Wider than the other views by default because a slide has to
 * show a real image next to its neighbours.
 *
 * The service adapter is the Gallery node's, verbatim in shape: both nodes need
 * session metadata, the live viewer Z plane, and the shared channel state.
 */

import { useSelector } from "@tanstack/react-store";
import { createCarouselDefinition } from "@ndea/nodes/carousel";
import type { ChannelHash } from "@ndea/nodes/gallery";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { passthroughGraphPredicate } from "@/core/graph/cook";
import { mountNodeBody } from "@/core/node/react-node-body";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { viewerChannelsStore } from "@/stores/viewer-channels-store";
import { viewerZStore } from "@/stores/viewer-z-store";

function useCarouselServices() {
  const { state } = useDatasetSession();
  const channels = useSelector(viewerChannelsStore, (store) => store.slots);
  const viewerZ = useSelector(viewerZStore, (store) => store.slots);
  return {
    dataset: {
      metadata: state.metadata,
      viewerZ: (instanceId: string) => viewerZ[instanceId] ?? 0,
      channels: (instanceId: string) => ({
        channels: channels[instanceId] ?? [],
        hash: JSON.stringify(channels[instanceId] ?? []) as ChannelHash,
        isPending: false,
      }),
    },
  };
}

export const carouselDefinition = createCarouselDefinition({
  mountBody: mountNodeBody,
  useServices: useCarouselServices,
});

export const carouselNode = defineNativeNodeContribution({
  definition: carouselDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: passthroughGraphPredicate,
  },
  presentation: {
    // Wider than the other views by default: the whole point is several
    // reconstructions side by side, and at 3-up a 720px body gives each slide
    // ~230px. The canvas caps resize at 780.
    geometry: { chipW: 148, card: { w: 320, h: 210 }, full: { w: 720, h: 460 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
