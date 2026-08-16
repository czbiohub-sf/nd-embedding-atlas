/**
 * gallery: plugin-backed view (the `gallery` descriptor renders the body).
 * Set-consuming cook: a pushed sel (lasso) takes over; else the AND of pred
 * inputs. Sink (no out port); accepts a pred or sel input.
 */

import { useSelector } from "@tanstack/react-store";
import { createGalleryDefinition, type ChannelHash } from "@ndea/nodes/gallery";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { lastPortValueOfKind, passthroughGraphPredicate } from "@/core/graph/cook";
import { mountNodeBody } from "@/core/node/react-node-body";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { viewerChannelsStore } from "@/stores/viewer-channels-store";

function useGalleryServices() {
  const { state } = useDatasetSession();
  const channels = useSelector(viewerChannelsStore, (store) => store.slots);
  return {
    dataset: {
      metadata: state.metadata,
      channels: (instanceId: string) => ({
        channels: channels[instanceId] ?? [],
        hash: JSON.stringify(channels[instanceId] ?? []) as ChannelHash,
        isPending: false,
      }),
    },
  };
}

export const galleryDefinition = createGalleryDefinition({
  mountBody: mountNodeBody,
  useServices: useGalleryServices,
});

export const galleryNode = defineNativeNodeContribution({
  definition: galleryDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => lastPortValueOfKind(inputs, "sel") ?? passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 132, card: { w: 220, h: 140 }, full: { w: 420, h: 360 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
