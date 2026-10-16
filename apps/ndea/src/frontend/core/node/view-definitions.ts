/**
 * The browser's view definitions: every dashboard component backed by a view
 * body, keyed by its component type (the node type id), with its app
 * services bound. The server reads the same definitions' contracts through
 * `COMPONENTS` without bodies.
 */

import { useSelector } from "@tanstack/react-store";
import { createNodeCatalog, type NodeCatalogServices } from "@ndea/nodes/catalog";
import type { ChannelHash } from "@ndea/nodes/gallery";
import { useColumnTypes, useMosaicClient } from "@ndea/nodes/query";
import { ChannelStatsResponseSchema, ObsInfoSchema } from "@ndea/protocol";
import type { NodeDefinition } from "@ndea/sdk";

import { onDeviceLost } from "@/core/gpu/device-manager";
import { requireAppNodeHostFacet } from "@/core/node/app-node-host";
import { mountNodeBody } from "@/core/node/react-node-body";
import { useColormapList, useColormapPalette } from "@/hooks/useColormaps";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { useFocusedPointMeta } from "@/hooks/useFocusedPointMeta";
import { makeCategoryColumn } from "@/lib/color/category-column";
import { buildColormapLut } from "@/lib/color/ochre-lut";
import { getColormapList, pickDefaultCategoricalPalette } from "@/lib/color/ochre-palette";
import { predicateToSql } from "@/lib/mosaic-helpers";
import { WsReconnectError, wsClient } from "@/lib/ws-client";
import { pointRadiusStore } from "@/stores/point-radius-store";
import { renderSettingsStore } from "@/stores/render-settings-store";
import { clearViewerChannels, publishViewerChannels, viewerChannelsStore } from "@/stores/viewer-channels-store";
import { clearViewerZ, publishViewerZ, viewerZStore } from "@/stores/viewer-z-store";

// Heterogeneous table: each definition keeps its precise author type until here.
// oxlint-disable-next-line no-explicit-any -- generic erasure for the mixed-config table.
export type ViewDefinition = NodeDefinition<any, any>;

function useViewerSlots() {
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

const bodyHeaderElement = (host: unknown) => requireAppNodeHostFacet(host, "bodyHeaderElement");

const services: NodeCatalogServices = {
  annotate: { useServices: useViewerSlots },
  charts: { useColumnTypes, useQuery: useMosaicClient },
  count: { predicateToSql },
  gallery: {
    useServices: () => {
      const { state } = useDatasetSession();
      return { dataset: { metadata: state.metadata, ...useViewerSlots() } };
    },
  },
  imageViewer: {
    useSessionSnapshot: () => {
      const { state, actions } = useDatasetSession();
      return { trajectories: state.trajectories, setTrajectoryTIndex: actions.setTrajectoryTIndex };
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
  },
  scatter: {
    useSession: useDatasetSession,
    useFocusedPointMeta,
    useColumnTypes,
    useColormapList,
    useColormapPalette,
    getColormapList,
    categorize: makeCategoryColumn,
    buildColormapLut,
    pickDefaultCategoricalPalette,
    pointRadiusStore,
    renderSettingsStore,
    wsClient,
    isReconnectError: (error) => error instanceof WsReconnectError,
    onDeviceLost,
    bodyHeaderElement,
  },
  table: { bodyHeaderElement },
};

export const VIEW_DEFINITIONS: Readonly<Record<string, ViewDefinition>> = Object.freeze(
  Object.fromEntries(
    Object.values(createNodeCatalog({ mountBody: mountNodeBody, services })).map((definition) => [
      definition.ref.nodeTypeId,
      definition,
    ]),
  ),
);
