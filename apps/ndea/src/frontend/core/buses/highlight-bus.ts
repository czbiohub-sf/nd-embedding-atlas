/** Process-wide highlighted row, shared by all views. */

import { Store } from "@tanstack/store";

export interface HighlightBus {
  readonly store: Store<string | null>;
  get(): string | null;
  set(id: string | null): void;
}

export function createHighlightBus(): HighlightBus {
  const store = new Store<string | null>(null);
  return {
    store,
    get() {
      return store.state;
    },
    set(id) {
      store.setState(() => id);
    },
  };
}

export const highlightBus: HighlightBus = createHighlightBus();
