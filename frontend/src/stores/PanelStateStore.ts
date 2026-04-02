import { Store } from "@tanstack/store";
import type { AxisState } from "../types";

export interface PanelState {
  axes: AxisState | null;
  colorByColumn: string | null;
}

/** Live state of all active panels (docked + floating). Updated on every axes/color change. */
export const panelStateStore = new Store<Map<string, PanelState>>(new Map());

export function broadcastPanelState(id: string, state: PanelState) {
  panelStateStore.setState((s) => new Map(s).set(id, state));
}

export function clearPanelState(id: string) {
  panelStateStore.setState((s) => {
    const m = new Map(s);
    m.delete(id);
    return m;
  });
}
