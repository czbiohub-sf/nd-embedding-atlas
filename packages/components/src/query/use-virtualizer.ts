import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type PartialKeys,
  type VirtualItem,
  Virtualizer,
  type VirtualizerOptions,
} from "@tanstack/virtual-core";
import { useLayoutEffect, useState, useSyncExternalStore } from "react";

export type UseVirtualizerOptions<TScroll extends Element, TItem extends Element> = PartialKeys<
  VirtualizerOptions<TScroll, TItem>,
  "observeElementRect" | "observeElementOffset" | "scrollToFn"
>;

/** Immutable per-change snapshot: safe to read during render. */
export interface VirtualizerSnapshot {
  virtualItems: VirtualItem[];
  totalSize: number;
  scrollMargin: number;
}

export interface VirtualizerView<TItem extends Element> extends VirtualizerSnapshot {
  scrollToIndex: Virtualizer<Element, TItem>["scrollToIndex"];
  measureElement: (node: TItem | null) => void;
}

/**
 * Same rows at the same offsets. `getVirtualItems()` returns a new array whenever
 * options change identity (every render), so identity alone would re-render forever.
 */
function sameItems(a: readonly VirtualItem[], b: readonly VirtualItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (item, i) =>
      item.key === b[i].key && item.index === b[i].index && item.start === b[i].start && item.size === b[i].size,
  );
}

/**
 * `observeElementRect`, plus a resync: a scroller that was detached or hidden
 * comes back at offset 0 with no scroll event, while the virtualizer keeps the
 * old offset and draws rows off-screen. Its next layout fires the resize
 * observer; a replayed scroll event makes the virtualizer re-read the offset.
 */
function observeRectAndOffset<TScroll extends Element, TItem extends Element>(
  instance: Virtualizer<TScroll, TItem>,
  cb: (rect: { width: number; height: number }) => void,
): void | (() => void) {
  return observeElementRect(instance, (rect) => {
    cb(rect);
    const el = instance.scrollElement;
    if (!el) return;
    const offset = instance.options.horizontal ? el.scrollLeft : el.scrollTop;
    if (Math.abs(offset - (instance.scrollOffset ?? 0)) >= 1) el.dispatchEvent(new Event("scroll"));
  });
}

function resolve<TScroll extends Element, TItem extends Element>(
  options: UseVirtualizerOptions<TScroll, TItem>,
  publish: () => void,
): VirtualizerOptions<TScroll, TItem> {
  return {
    observeElementRect: observeRectAndOffset,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...options,
    onChange: (instance, sync) => {
      publish();
      options.onChange?.(instance, sync);
    },
  };
}

/**
 * `@tanstack/virtual-core` bound to React through an external store, so render
 * reads an immutable snapshot instead of the mutable `Virtualizer` (which the
 * React Compiler cannot memoize; see `@tanstack/react-virtual`).
 */
export function useVirtualizer<TScroll extends Element, TItem extends Element>(
  options: UseVirtualizerOptions<TScroll, TItem>,
): VirtualizerView<TItem> {
  const [store] = useState(() => {
    const listeners = new Set<() => void>();
    const instance = new Virtualizer<TScroll, TItem>(resolve(options, () => publish()));
    const read = (): VirtualizerSnapshot => ({
      virtualItems: instance.getVirtualItems(),
      totalSize: instance.getTotalSize(),
      scrollMargin: instance.options.scrollMargin,
    });
    let snapshot = read();
    const publish = () => {
      const next = read();
      if (
        sameItems(next.virtualItems, snapshot.virtualItems) &&
        next.totalSize === snapshot.totalSize &&
        next.scrollMargin === snapshot.scrollMargin
      ) {
        return;
      }
      snapshot = next;
      for (const listener of listeners) listener();
    };
    return {
      instance,
      publish,
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  });

  useLayoutEffect(() => store.instance._didMount(), [store]);

  useLayoutEffect(() => {
    store.instance.setOptions(resolve(options, store.publish));
    store.instance._willUpdate();
    store.publish();
  });

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, scrollToIndex: store.instance.scrollToIndex, measureElement: store.instance.measureElement };
}
