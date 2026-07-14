/** Process-wide linked pan and zoom state. */

import { broadcastViewState, toggleViewLock, viewSyncStore, type ViewSyncState } from "@/stores/view-sync-store";
import { panelId } from "@/lib/branded-types";
import type { ViewState } from "@/types";
import type { NodeInstanceId } from "@ndea/sdk";

export interface ViewSyncBus {
  snapshot(): ViewSyncState;
  broadcast(instanceId: NodeInstanceId, state: ViewState): void;
  toggleLock(): void;
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

export const viewSyncBus: ViewSyncBus = createViewSyncBus();
