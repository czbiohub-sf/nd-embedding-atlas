/** Process-wide focused row, shared by all views. */

import { Store } from "@tanstack/store";
import type { RowIndex } from "@ndea/sdk";

export interface FocusBus {
  readonly store: Store<RowIndex | null>;
  get(): RowIndex | null;
  set(rowIndex: RowIndex | null): void;
  clear(): void;
  subscribe(callback: (rowIndex: RowIndex | null) => void): () => void;
}

export function createFocusBus(): FocusBus {
  const store = new Store<RowIndex | null>(null);
  return {
    store,
    get() {
      return store.state;
    },
    set(rowIndex) {
      store.setState(() => rowIndex);
    },
    clear() {
      store.setState(() => null);
    },
    subscribe(callback) {
      const subscription = store.subscribe(() => callback(store.state));
      return () => subscription.unsubscribe();
    },
  };
}

export const focusBus: FocusBus = createFocusBus();
