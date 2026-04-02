import { Store } from "@tanstack/store";
import type { ObsSetId } from "../lib/branded-types";
import type { ObsSet } from "../lib/schemas";

export type { ObsSet };

interface ObsSetStoreState {
  obssets: Record<string, ObsSet>; // keyed by obsset_id
  activeObsSetId: ObsSetId | null;
}

export const obsSetStore = new Store<ObsSetStoreState>({
  obssets: {},
  activeObsSetId: null,
});

export function setActiveObsSet(id: ObsSetId | null): void {
  obsSetStore.setState((s) => ({ ...s, activeObsSetId: id }));
}

export function updateObsSets(list: ObsSet[]): void {
  obsSetStore.setState((s) => ({
    ...s,
    obssets: Object.fromEntries(list.map((o) => [o.obsset_id, o])),
  }));
}
