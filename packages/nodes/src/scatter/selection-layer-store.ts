import { Store } from "@tanstack/store";
import type { PanelId } from "./contracts";

type LayerName = "external" | "highlight" | "isolation" | "lasso";
interface LayerSlot {
  version: number;
  isActive: boolean;
}
type PanelLayerState = Record<LayerName, LayerSlot>;

const emptySlot = (): LayerSlot => ({ version: 0, isActive: false });
const emptyPanelState = (): PanelLayerState => ({
  external: emptySlot(),
  highlight: emptySlot(),
  isolation: emptySlot(),
  lasso: emptySlot(),
});

export const selectionLayerStore = new Store(new Map<PanelId, PanelLayerState>());

export function initPanelLayerState(id: PanelId): void {
  selectionLayerStore.setState((state) => new Map(state).set(id, emptyPanelState()));
}

export function clearPanelLayerState(id: PanelId): void {
  selectionLayerStore.setState((state) => {
    const next = new Map(state);
    next.delete(id);
    return next;
  });
}
