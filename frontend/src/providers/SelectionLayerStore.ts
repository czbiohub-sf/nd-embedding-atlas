import { Store } from "@tanstack/store";
import type { PanelId } from "../lib/branded-types";

/**
 * SelectionLayerStore — per-panel compositor layer metadata.
 *
 * Keyed by PanelId (same pattern as PanelStateStore).
 *
 * This store holds METADATA ONLY (version + isActive flags).
 * Actual GPU buffer writes happen imperatively via ScatterplotHandle refs.
 * The store drives subscriptions so React components and GPU subscribers
 * can react to layer changes without polling.
 *
 * Cross-panel rule: when panel A broadcasts, panel B writes its own
 * `external` slot — never panel A's slot.
 */

export interface LayerSlot {
  /** Incremented on every write to this layer slot. Used as React dep. */
  version: number;
  /** True if this layer currently has active data. */
  isActive: boolean;
}

export interface PanelLayerState {
  lasso: LayerSlot;
  external: LayerSlot;
  isolation: LayerSlot;
  annotation: LayerSlot;
}

function emptySlot(): LayerSlot {
  return { version: 0, isActive: false };
}

function emptyPanelState(): PanelLayerState {
  return {
    lasso: emptySlot(),
    external: emptySlot(),
    isolation: emptySlot(),
    annotation: emptySlot(),
  };
}

export const selectionLayerStore = new Store<Map<PanelId, PanelLayerState>>(new Map());

export function initPanelLayerState(panelId: PanelId): void {
  selectionLayerStore.setState((m) => new Map(m).set(panelId, emptyPanelState()));
}

export function clearPanelLayerState(panelId: PanelId): void {
  selectionLayerStore.setState((m) => {
    const next = new Map(m);
    next.delete(panelId);
    return next;
  });
}

export type LayerName = keyof PanelLayerState;

export function setLayerActive(panelId: PanelId, layer: LayerName, isActive: boolean): void {
  selectionLayerStore.setState((m) => {
    const panelState = m.get(panelId) ?? emptyPanelState();
    const slot = panelState[layer];
    const nextSlot: LayerSlot = { version: slot.version + 1, isActive };
    return new Map(m).set(panelId, { ...panelState, [layer]: nextSlot });
  });
}

/** Clear all layers for a panel (e.g. on data reload). */
export function clearAllLayersForPanel(panelId: PanelId): void {
  selectionLayerStore.setState((m) => new Map(m).set(panelId, emptyPanelState()));
}
