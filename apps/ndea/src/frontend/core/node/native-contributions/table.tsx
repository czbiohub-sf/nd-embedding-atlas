/**
 * table: plugin-backed view (the `table` descriptor renders the body). Cooks
 * as a predicate pass-through; its row focus rides the push port (focus), delivered
 * downstream outside the cook. Out port is `focus` (table row → image viewer).
 */

import { useSelector } from "@tanstack/react-store";
import { createTableDefinition } from "@ndea/nodes/table";
import type { ChannelHash } from "@ndea/nodes/gallery";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { passthroughGraphPredicate } from "@/core/graph/cook";
import { mountNodeBody } from "@/core/node/react-node-body";
import { requireAppNodeHostFacet } from "@/core/node/app-node-host";
import { viewerChannelsStore } from "@/stores/viewer-channels-store";
import { viewerZStore } from "@/stores/viewer-z-store";

/**
 * A hook, like the annotate contribution: the row-detail crop reads live viewer
 * channels and Z, so the body must re-render when those stores change.
 */
function useTableServices() {
  const channels = useSelector(viewerChannelsStore, (store) => store.slots);
  const viewerZ = useSelector(viewerZStore, (store) => store.slots);
  return {
    bodyHeaderElement: (host: unknown) => requireAppNodeHostFacet(host, "bodyHeaderElement"),
    viewerZ: (instanceId: string) => viewerZ[instanceId] ?? 0,
    channels: (instanceId: string) => ({
      channels: channels[instanceId] ?? [],
      hash: JSON.stringify(channels[instanceId] ?? []) as ChannelHash,
      isPending: false,
    }),
  };
}

export const tableDefinition = createTableDefinition({
  mountBody: mountNodeBody,
  useServices: useTableServices,
});

export const tableNode = defineNativeNodeContribution({
  definition: tableDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 128, card: { w: 224, h: 128 }, full: { w: 460, h: 320 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
    requiredHostFacets: ["bodyHeaderElement"],
  },
});
