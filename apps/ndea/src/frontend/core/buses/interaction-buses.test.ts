import { afterEach, describe, expect, test } from "bun:test";
import type { Selection } from "@uwdata/mosaic-core";
import { nodeInstanceId, rowIndex, type RowIndex } from "@ndea/sdk";
import { clearRowSetSync } from "@/stores/row-set-sync-store";
import { createFocusBus } from "./focus-bus";
import { createPredicateBus } from "./predicate-bus";
import { createRowSetBus } from "./row-set-bus";

const SOURCE = nodeInstanceId("source");
const PEER = nodeInstanceId("peer");

afterEach(() => {
  clearRowSetSync();
  const rowSets = createRowSetBus();
  rowSets.disposeFor(SOURCE);
  rowSets.disposeFor(PEER);
});

describe("interaction buses", () => {
  test("focus set, replacement, clear, and unsubscribe affect only focus", () => {
    const focus = createFocusBus();
    const predicate = createPredicateBus();
    const seen: (RowIndex | null)[] = [];
    const unsubscribe = focus.subscribe((value) => seen.push(value));

    focus.set(rowIndex(3));
    focus.set(rowIndex(8));
    focus.clear();

    expect(focus.get()).toBeNull();
    expect(seen).toEqual([rowIndex(3), rowIndex(8), null]);
    expect(predicate.revision.state).toBe(0);

    unsubscribe();
    focus.set(rowIndex(13));
    expect(seen).toEqual([rowIndex(3), rowIndex(8), null]);
  });

  test("row-set subscriptions ignore self events and preserve active empty sets", () => {
    const focus = createFocusBus();
    const rowSets = createRowSetBus();
    const seen: (readonly RowIndex[] | null)[] = [];
    const unsubscribe = rowSets.subscribeExternal(SOURCE, (value) => seen.push(value));

    focus.set(rowIndex(21));
    rowSets.publishRowSet(SOURCE, [rowIndex(1)]);
    expect(seen).toEqual([]);

    rowSets.publishRowSet(PEER, [rowIndex(2), rowIndex(5)]);
    rowSets.publishRowSet(PEER, []);
    rowSets.clear(PEER);

    expect(seen).toEqual([[rowIndex(2), rowIndex(5)], [], null]);
    expect(rowSets.externalRowSet(SOURCE)).toBeNull();
    expect(rowSets.rowIndices(PEER)).toEqual([]);
    expect(focus.get()).toBe(rowIndex(21));

    unsubscribe();
    rowSets.publishRowSet(PEER, [rowIndex(34)]);
    expect(seen).toHaveLength(3);
  });

  test("predicate facet composition and clearing do not mutate focus or row sets", () => {
    const scheduled: FrameRequestCallback[] = [];
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      scheduled.push(callback);
      return scheduled.length;
    }) as typeof requestAnimationFrame;

    try {
      const focus = createFocusBus();
      const rowSets = createRowSetBus();
      const predicate = createPredicateBus();
      const updates: { value: unknown[] }[] = [];
      const destination = {
        update(event: { value: unknown[] }) {
          updates.push(event);
        },
      } as unknown as Selection;
      const revisionEvents: number[] = [];
      const subscription = predicate.revision.subscribe(() => revisionEvents.push(predicate.revision.state));
      predicate.attachDestination(destination);

      focus.set(rowIndex(7));
      rowSets.publishRowSet(PEER, [rowIndex(11)]);
      expect(predicate.revision.state).toBe(0);

      predicate.publishPredicate(SOURCE, "lasso", "x > 1");
      predicate.publishPredicate(SOURCE, "range", "y < 9");
      scheduled.shift()?.(performance.now());

      expect(updates.at(-1)?.value).toEqual(["(x > 1) AND (y < 9)"]);
      expect(revisionEvents).toEqual([1, 2]);
      expect(focus.get()).toBe(rowIndex(7));
      expect(rowSets.externalRowSet(SOURCE)).toEqual([rowIndex(11)]);

      predicate.clearFacet("lasso");
      scheduled.shift()?.(performance.now());
      expect(updates.at(-1)?.value).toEqual(["y < 9"]);
      expect(revisionEvents).toEqual([1, 2, 3]);

      subscription.unsubscribe();
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });
});
