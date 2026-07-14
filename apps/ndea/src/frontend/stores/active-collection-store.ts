import { Store } from "@tanstack/store";
import type { CollectionId } from "../lib/branded-types";

/**
 * Tracks which collection is currently driving the dataset filter.
 *
 * v1 is single-active. PR 3 generalises to a `Set<CollectionId>` + boolean
 * op composition (UNION / INTERSECT / SUBTRACT).
 *
 * The filter wiring lives in DatasetSessionProvider: when activeCollectionId
 * flips, it fetches `/api/collections/:id/activate` and publishes the returned
 * predicate as the "activeSet" facet on the collections pseudo-instance via the
 * SelectionBus (the sole writer of Mosaic's crossfilter Selection, §6.3).
 */

interface ActiveCollectionState {
  activeId: CollectionId | null;
}

export const activeCollectionStore = new Store<ActiveCollectionState>({
  activeId: null,
});

export function setActiveCollection(id: CollectionId | null): void {
  activeCollectionStore.setState((s) => (s.activeId === id ? s : { ...s, activeId: id }));
}
