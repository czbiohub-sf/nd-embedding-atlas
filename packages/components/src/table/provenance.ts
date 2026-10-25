/**
 * Settings › "Provenance badges": whether table headers mark saved and unsaved
 * fields. A per-browser UI preference (like the theme), kept in localStorage
 * and out of the workspace document.
 */

import { useSyncExternalStore } from "react";

const KEY = "ndea.table.provenanceBadges";
const listeners = new Set<() => void>();

const read = () => globalThis.localStorage?.getItem(KEY) !== "off";

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setProvenanceBadges(on: boolean): void {
  globalThis.localStorage?.setItem(KEY, on ? "on" : "off");
  for (const listener of listeners) listener();
}

export function useProvenanceBadges(): boolean {
  return useSyncExternalStore(subscribe, read, read);
}
