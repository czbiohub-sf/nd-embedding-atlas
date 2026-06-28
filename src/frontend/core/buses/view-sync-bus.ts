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
import type { NodeInstanceId } from "@/core/node/host";

export interface ViewSyncBus {
  snapshot(): ViewSyncState;
  broadcast(instanceId: NodeInstanceId, state: ViewState): void;
  toggleLock(): void;
  /** Fire on an incoming (linked, non-self) pan/zoom broadcast. The global-bus
   *  backing for `host.viewSync.subscribe`; the workspace overrides this with a
   *  coordination-scoped subscribe at the body-dock seam. */
  subscribe(instanceId: NodeInstanceId, cb: (state: { panX: number; panY: number; zoom: number }) => void): () => void;
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
    subscribe(instanceId, cb) {
      const self = panelId(instanceId as string);
      const sub = viewSyncStore.subscribe(() => {
        const s = viewSyncStore.state;
        if (s.lockMode !== "linked" || s.sourcePanelId === self) return;
        cb({ panX: s.panX, panY: s.panY, zoom: s.zoom });
      });
      return () => sub.unsubscribe();
    },
  };
}

/** Process-wide view-sync bus — one pan/zoom lock state across panels. */
export const viewSyncBus: ViewSyncBus = createViewSyncBus();
