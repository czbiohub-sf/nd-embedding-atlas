/**
 * annotate: plugin-backed terminal view (the `annotate` descriptor renders the
 * body). A labeling cursor over a working set: consumes the upstream predicate
 * (predicate pass-through cook) as its iteration domain, and emits a `focus` out the
 * push port (the obs under the cursor) so wired viewers: Image Viewer and
 * Gallery: follow it, exactly as a Table row focus does. The focus rides
 * authored graph output through the host; the cook still carries the pred so the
 * batch path keeps a scope to stamp.
 */

import { useSelector } from "@tanstack/react-store";
import { createAnnotateDefinition } from "@ndea/nodes/annotate";
import type { ChannelHash } from "@ndea/nodes/gallery";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { passthroughGraphPredicate } from "@/core/graph/cook";
import { mountNodeBody } from "@/core/node/react-node-body";
import { viewerChannelsStore } from "@/stores/viewer-channels-store";
import { viewerZStore } from "@/stores/viewer-z-store";

function useAnnotateServices() {
  const channels = useSelector(viewerChannelsStore, (store) => store.slots);
  const viewerZ = useSelector(viewerZStore, (store) => store.slots);
  return {
    viewerZ: (instanceId: string) => viewerZ[instanceId] ?? 0,
    channels: (instanceId: string) => ({
      channels: channels[instanceId] ?? [],
      hash: JSON.stringify(channels[instanceId] ?? []) as ChannelHash,
      isPending: false,
    }),
  };
}

export const annotateDefinition = createAnnotateDefinition({
  mountBody: mountNodeBody,
  useServices: useAnnotateServices,
});

export const annotateNode = defineNativeNodeContribution({
  definition: annotateDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 256, h: 180 }, full: { w: 320, h: 360 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
