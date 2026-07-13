/** Cross-panel row selections backed by per-source Roaring bitmaps. */

import { broadcastSelection, clearSelectionSync, selectionSyncStore } from "@/stores/SelectionSyncStore";
import { disposeBitmap, getBitmapRowIds } from "@/stores/RoaringBroadcastStore";
import { panelSource, type SelectionSource, sourcesEqual } from "@/stores/SelectionSource";
import { panelId } from "@/lib/branded-types";
import type { NodeInstanceId } from "@ndea/sdk";

export interface BroadcastBus {
  publishRowSet(instanceId: NodeInstanceId, ids: number[]): void;
  rowIds(instanceId: NodeInstanceId): number[];
  clear(instanceId: NodeInstanceId): void;
  disposeFor(instanceId: NodeInstanceId): void;
  /** Returns the active non-self selection. */
  externalRowSet(instanceId: NodeInstanceId): readonly number[] | null;
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
      if (sourcesEqual(s.source, sourceFor(instanceId))) return null;
      return getBitmapRowIds(s.source);
    },
    subscribeExternal(instanceId, cb) {
      const self = sourceFor(instanceId);
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
