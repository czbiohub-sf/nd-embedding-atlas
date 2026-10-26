/**
 * The browser's component definitions: every dashboard component backed by a
 * view body, keyed by its type, with its app services bound. The server reads the same definitions' contracts through
 * `COMPONENTS` without bodies.
 */

import { useSelector } from "@tanstack/react-store";
import { createComponentCatalog, type ComponentServices } from "@ndea/components/catalog";
import type { ChannelHash } from "@ndea/components/gallery";
import { useMosaicClient } from "@ndea/components/query";
import { buildLut } from "@ndea/ochre/palette";
import { ChannelStatsResponseSchema, ObsInfoSchema } from "@ndea/protocol";
import type { ComponentDefinition } from "@ndea/sdk";

import { onDeviceLost } from "@/core/gpu/device-manager";
import { mountReactBody } from "@/core/component/react-body";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { useFocusedPointMeta } from "@/hooks/useFocusedPointMeta";
import { makeCategoryColumn } from "@/lib/color/category-column";
import { getCategoricalPalette, getColormapList, pickDefaultCategoricalPalette } from "@/lib/color/ochre-palette";
import { renderSettingsStore } from "@/stores/render-settings-store";
import { clearViewerChannels, publishViewerChannels, viewerChannelsStore } from "@/stores/viewer-channels-store";
import { clearViewerZ, publishViewerZ, viewerZStore } from "@/stores/viewer-z-store";

// Heterogeneous table: each definition keeps its precise config type until here.
// oxlint-disable-next-line no-explicit-any -- generic erasure for the mixed-config table.
export type AnyComponentDefinition = ComponentDefinition<any>;

// Bun tests import this module without a DOM.
const renderParams = new URLSearchParams(globalThis.location?.search);
/**
 * Set in the headless tab remote rendering opens (`/render/image`, see
 * `server/remote-render.ts`): the one element it renders and its session.
 */
export const RENDER_PAGE =
  globalThis.location?.pathname === "/render/image" && renderParams.get("session")
    ? {
        element: renderParams.get("element") ?? "",
        session: renderParams.get("session")!,
        fps: Number(renderParams.get("fps")) || 60,
        bpp: Number(renderParams.get("bpp")) || 0.1,
      }
    : null;

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
  charts: { useQuery: useMosaicClient },
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
    remote: {
      connect: (session) => {
        const url = new URL("/ws/render", location.href);
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        if (session) url.searchParams.set("session", session);
        const socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
        return socket;
      },
      page: RENDER_PAGE,
    },
  },
  scatter: {
    useSession: useDatasetSession,
    useFocusedPointMeta,
    getCategoricalPalette,
    getColormapList,
    categorize: makeCategoryColumn,
    buildColormapLut: buildLut,
    pickDefaultCategoricalPalette,
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
