/**
 * BroadcastBus (PLUGIN-ARCHITECTURE §6) — the core seam for `publishRowSet`,
 * the GPU dim-mask broadcast used for cross-panel highlighting. Phase 0 forwards
 * to `SelectionSyncStore` (which writes the row ids into the per-source Roaring
 * bitmap in `RoaringBroadcastStore`), keyed by a `panel` source derived from the
 * instance id. Bitmap memory is released on instance teardown via `disposeFor`.
 */

import { broadcastSelection, clearSelectionSync, selectionSyncStore } from "@/stores/SelectionSyncStore";
import { disposeBitmap, getBitmapRowIds } from "@/stores/RoaringBroadcastStore";
import { panelSource, type SelectionSource, sourcesEqual } from "@/stores/SelectionSource";
import { panelId } from "@/lib/branded-types";
import type { NodeInstanceId } from "@/core/node/host";

export interface BroadcastBus {
  /** Broadcast this instance's selected row ids (WASM bitmap + sync store). */
  publishRowSet(instanceId: NodeInstanceId, ids: number[]): void;
  /** Read back the row ids currently broadcast by this instance. */
  rowIds(instanceId: NodeInstanceId): number[];
  /** Clear the broadcast without disposing the bitmap (reusable). */
  clear(instanceId: NodeInstanceId): void;
  /** Release the instance's WASM bitmap on teardown. */
  disposeFor(instanceId: NodeInstanceId): void;
  /**
   * Current external (non-self) broadcast row-set — the active source's bitmap,
   * or null when empty or when the active source IS this instance. The read side
   * of the cross-panel selection-in mirror (PLUGIN-ARCHITECTURE §6.7).
   */
  externalRowSet(instanceId: NodeInstanceId): readonly number[] | null;
  /**
   * Subscribe to external (non-self) row-set changes for this instance; fires on
   * every broadcast/clear from a DIFFERENT source (self updates filtered out).
   * `rowIds` is null on clear/empty. Returns an unsubscribe.
   */
  subscribeExternal(instanceId: NodeInstanceId, cb: (rowIds: readonly number[] | null) => void): () => void;
}

const sourceFor = (instanceId: NodeInstanceId): SelectionSource => panelSource(panelId(instanceId as string));

export function createBroadcastBus(): BroadcastBus {
  return {
    publishRowSet(instanceId, ids) {
      broadcastSelection(sourceFor(instanceId), ids);
    },
    rowIds(instanceId) {
      return getBitmapRowIds(sourceFor(instanceId));
    },
    clear(instanceId) {
      clearSelectionSync(sourceFor(instanceId));
    },
    disposeFor(instanceId) {
      disposeBitmap(sourceFor(instanceId));
    },
    externalRowSet(instanceId) {
      const s = selectionSyncStore.state;
      if (s.type === "empty") return null;
      if (sourcesEqual(s.source, sourceFor(instanceId))) return null; // self → null
      return getBitmapRowIds(s.source);
    },
    subscribeExternal(instanceId, cb) {
      const self = sourceFor(instanceId);
      // Fires on the store's version bump (the change signal); row ids live in
      // the WASM bitmap and are re-read here — same mechanism the inline scatter
      // subscription used. Self-originated events are filtered (no self-echo).
      const sub = selectionSyncStore.subscribe(() => {
        const s = selectionSyncStore.state;
        if (s.type === "empty") {
          if (s.source && sourcesEqual(s.source, self)) return; // self-originated clear → skip
          cb(null);
          return;
        }
        if (sourcesEqual(s.source, self)) return; // self-originated active → skip
        cb(getBitmapRowIds(s.source));
      });
      return () => sub.unsubscribe();
    },
  };
}

/** Process-wide broadcast bus — one app-level selection mirror. */
export const broadcastBus: BroadcastBus = createBroadcastBus();
