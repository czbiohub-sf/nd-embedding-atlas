/**
 * fov-label: plugin-backed view laying each well out as its physical grid of fields,
 * with the `goodness` label carried by the cell outline.
 *
 * Sink (no out port). Cooks like the gallery — a pushed sel wins, else the AND of pred
 * inputs — but the body draws the whole plate regardless: the geometry is the reading.
 */

import { useSelector } from "@tanstack/react-store";
import { createFovLabelDefinition } from "@ndea/nodes/fov-label";
import type { ChannelHash } from "@ndea/nodes/gallery";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { lastPortValueOfKind, passthroughGraphPredicate } from "@/core/graph/cook";
import { mountNodeBody } from "@/core/node/react-node-body";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { viewerChannelsStore } from "@/stores/viewer-channels-store";
import { viewerZStore } from "@/stores/viewer-z-store";

function useFovLabelServices() {
  const { state } = useDatasetSession();
  const channels = useSelector(viewerChannelsStore, (store) => store.slots);
  const viewerZ = useSelector(viewerZStore, (store) => store.slots);
  return {
    metadata: state.metadata,
    viewerZ: (instanceId: string) => viewerZ[instanceId] ?? 0,
    channels: (instanceId: string) => ({
      channels: channels[instanceId] ?? [],
      hash: JSON.stringify(channels[instanceId] ?? []) as ChannelHash,
      isPending: false,
    }),
  };
}

export const fovLabelDefinition = createFovLabelDefinition({
  mountBody: mountNodeBody,
  useServices: useFovLabelServices,
});

export const fovLabelNode = defineNativeNodeContribution({
  definition: fovLabelDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => lastPortValueOfKind(inputs, "sel") ?? passthroughGraphPredicate(inputs),
  },
  presentation: {
    // Wider default than the gallery: a 7x7 grid per well, several wells across.
    geometry: { chipW: 132, card: { w: 260, h: 160 }, full: { w: 560, h: 420 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
