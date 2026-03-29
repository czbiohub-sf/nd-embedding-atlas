import { Store } from "@tanstack/store";
import type { PanelId } from "../lib/branded-types";
import type { ViewState } from "../types";

export type ViewLockMode = "linked" | "independent";

export interface ViewSyncState {
  panX: number;
  panY: number;
  zoom: number;
  sourcePanelId: PanelId | null;
  lockMode: ViewLockMode;
}

export const viewSyncStore = new Store<ViewSyncState>({
  panX: 0,
  panY: 0,
  zoom: 1,
  sourcePanelId: null,
  lockMode: "independent",
});

export function broadcastViewState(
  id: PanelId,
  state: ViewState,
) {
  viewSyncStore.setState((s) => ({ ...s, ...state, sourcePanelId: id }));
}

export function toggleViewLock() {
  viewSyncStore.setState((s) => ({
    ...s,
    lockMode: s.lockMode === "linked" ? "independent" : "linked",
  }));
}
