/**
 * Image Viewer: plugin-backed, focus-consuming view. Its cook takes the latest
 * pushed focused row. It is a sink with no output port.
 */

import { createImageViewerDefinition, type ImageViewerServices } from "@ndea/nodes/image-viewer";
import { ChannelStatsResponseSchema, ObsInfoSchema } from "@ndea/protocol";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { lastPortValueOfKind } from "@/core/graph/cook";
import { mountNodeBody } from "@/core/node/react-node-body";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { clearViewerChannels, publishViewerChannels } from "@/stores/viewer-channels-store";
import { clearViewerZ, publishViewerZ } from "@/stores/viewer-z-store";

const services: ImageViewerServices = {
  useSessionSnapshot: () => {
    const { state, actions } = useDatasetSession();
    return {
      trajectories: state.trajectories,
      setTrajectoryTIndex: actions.setTrajectoryTIndex,
    };
  },
  loadCrop: async (rowIndex, signal) => {
    const response = await fetch(`/api/obs/${rowIndex}`, { signal });
    return ObsInfoSchema.parse(await response.json());
  },
  loadChannelStats: async (fovName, datasetKey, signal) => {
    const suffix = datasetKey ? `?dataset_key=${encodeURIComponent(datasetKey)}` : "";
    const response = await fetch(`/api/channel-stats/${encodeURIComponent(fovName)}${suffix}`, { signal });
    if (!response.ok) return null;
    return ChannelStatsResponseSchema.parse(await response.json()).channels;
  },
  sharedState: {
    publishChannels: publishViewerChannels,
    clearChannels: clearViewerChannels,
    publishZ: publishViewerZ,
    clearZ: clearViewerZ,
  },
};

export const imageViewerDefinition = createImageViewerDefinition({
  mountBody: mountNodeBody,
  services,
});

export const imageViewerNode = defineNativeNodeContribution({
  definition: imageViewerDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => ({ kind: "focus", rowIndex: lastPortValueOfKind(inputs, "focus")?.rowIndex ?? null }),
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 220, h: 156 }, full: { w: 440, h: 420 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
  },
});
