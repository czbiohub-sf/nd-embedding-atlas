/**
 * ViewSyncBus (PLUGIN-ARCHITECTURE §6) — the core seam behind `host.viewSync`.
 * A thin pass-through over `ViewSyncStore`: pan/zoom broadcast for linked
 * panels plus the linked/independent lock toggle. The host's reactive
 * `ViewSyncApi` getters read `snapshot()`; `subscribe` lets a view react to
 * upstream pan/zoom without coupling to the store import directly.
 */

import { broadcastViewState, toggleViewLock, viewSyncStore, type ViewSyncState } from "@/stores/ViewSyncStore";
import { panelId } from "@/lib/branded-types";
import type { ViewState } from "@/types";
import type { PluginInstanceId } from "@/core/plugin/host";

export interface ViewSyncBus {
  snapshot(): ViewSyncState;
  broadcast(instanceId: PluginInstanceId, state: ViewState): void;
  toggleLock(): void;
}

export function createViewSyncBus(): ViewSyncBus {
  return {
    snapshot() {
      return viewSyncStore.state;
    },
    broadcast(instanceId, state) {
      broadcastViewState(panelId(instanceId as string), state);
    },
    toggleLock() {
      toggleViewLock();
    },
  };
}

/** Process-wide view-sync bus — one pan/zoom lock state across panels. */
export const viewSyncBus: ViewSyncBus = createViewSyncBus();
