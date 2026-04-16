import { Store } from "@tanstack/store";
import type { AxisState } from "../types";

export interface FloatingScatterEntry {
    id: string;
    axes: AxisState;
    colorByColumn: string | null;
    /** When set, this floating panel mirrors the named panel's axes/color */
    linkedPanelId?: string;
}

export const floatingScatterStore = new Store<FloatingScatterEntry[]>([]);

export function addFloatingScatter(entry: FloatingScatterEntry) {
    floatingScatterStore.setState((s) => [...s, entry]);
}

export function removeFloatingScatter(id: string) {
    floatingScatterStore.setState((s) => s.filter((e) => e.id !== id));
}

export function setFloatingScatterLink(id: string, linkedPanelId: string | undefined) {
    floatingScatterStore.setState((s) => s.map((e) => (e.id === id ? { ...e, linkedPanelId } : e)));
}
