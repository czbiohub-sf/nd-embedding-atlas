/**
 * The browser's component definitions: every dashboard component backed by a
 * view body, keyed by its type, with its app services bound. The server reads the same definitions' contracts through
 * `COMPONENTS` without bodies.
 */

import { useSelector } from "@tanstack/react-store";
import { createComponentCatalog, type ComponentServices } from "@ndea/components/catalog";
import type { ChannelHash } from "@ndea/components/gallery";
import { useColumnTypes, useMosaicClient } from "@ndea/components/query";
import { ChannelStatsResponseSchema, ObsInfoSchema } from "@ndea/protocol";
import type { ComponentDefinition } from "@ndea/sdk";

import { onDeviceLost } from "@/core/gpu/device-manager";
import { mountReactBody } from "@/core/component/react-body";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { useFocusedPointMeta } from "@/hooks/useFocusedPointMeta";
import { makeCategoryColumn } from "@/lib/color/category-column";
import { buildColormapLut } from "@/lib/color/ochre-lut";
import { getCategoricalPalette, getColormapList, pickDefaultCategoricalPalette } from "@/lib/color/ochre-palette";
import { predicateToSql } from "@/lib/mosaic-helpers";
import { pointRadiusStore } from "@/stores/point-radius-store";
import { renderSettingsStore } from "@/stores/render-settings-store";
import { clearViewerChannels, publishViewerChannels, viewerChannelsStore } from "@/stores/viewer-channels-store";
import { clearViewerZ, publishViewerZ, viewerZStore } from "@/stores/viewer-z-store";

// Heterogeneous table: each definition keeps its precise config type until here.
// oxlint-disable-next-line no-explicit-any -- generic erasure for the mixed-config table.
export type AnyComponentDefinition = ComponentDefinition<any>;

function useViewerSlots() {
  const channels = useSelector(viewerChannelsStore, (store) => store.slots);
  const viewerZ = useSelector(viewerZStore, (store) => store.slots);
  return {
    viewerZ: (elementId: string) => viewerZ[elementId] ?? 0,
    channels: (elementId: string) => ({
      channels: channels[elementId] ?? [],
      hash: JSON.stringify(channels[elementId] ?? []) as ChannelHash,
      isPending: false,
    }),
  };
}

const services: ComponentServices = {
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
    getCategoricalPalette,
    getColormapList,
    categorize: makeCategoryColumn,
    buildColormapLut,
    pickDefaultCategoricalPalette,
    pointRadiusStore,
    renderSettingsStore,
    onDeviceLost,
  },
};

export const COMPONENT_DEFINITIONS: Readonly<Record<string, AnyComponentDefinition>> = Object.freeze(
  Object.fromEntries(
    Object.values(createComponentCatalog({ mountBody: mountReactBody, services })).map((definition) => [
      definition.type,
      definition,
    ]),
  ),
);
