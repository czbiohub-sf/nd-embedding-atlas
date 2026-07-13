/** Cross-panel row selections backed by per-source Roaring bitmaps. */

import { broadcastRowSet, clearRowSetSync, rowSetSyncStore } from "@/stores/RowSetSyncStore";
import { disposeBitmap, getBitmapRowIndices } from "@/stores/RoaringBroadcastStore";
import { panelSource, type RowSetSource, sourcesEqual } from "@/stores/RowSetSource";
import { panelId } from "@/lib/branded-types";
import type { NodeInstanceId, RowIndex } from "@ndea/sdk";

export interface RowSetBus {
  publishRowSet(instanceId: NodeInstanceId, rowIndices: RowIndex[]): void;
  rowIndices(instanceId: NodeInstanceId): RowIndex[];
  clear(instanceId: NodeInstanceId): void;
  disposeFor(instanceId: NodeInstanceId): void;
  /** Returns the active non-self selection. */
  externalRowSet(instanceId: NodeInstanceId): readonly RowIndex[] | null;
  subscribeExternal(instanceId: NodeInstanceId, callback: (rowIndices: readonly RowIndex[] | null) => void): () => void;
}

const sourceFor = (instanceId: NodeInstanceId): RowSetSource => panelSource(panelId(instanceId as string));

export function createRowSetBus(): RowSetBus {
  return {
    publishRowSet(instanceId, rowIndices) {
      broadcastRowSet(sourceFor(instanceId), rowIndices);
    },
    rowIndices(instanceId) {
      return getBitmapRowIndices(sourceFor(instanceId));
    },
    clear(instanceId) {
      clearRowSetSync(sourceFor(instanceId));
    },
    disposeFor(instanceId) {
      disposeBitmap(sourceFor(instanceId));
    },
    externalRowSet(instanceId) {
      const s = rowSetSyncStore.state;
      if (s.type === "empty") return null;
      if (sourcesEqual(s.source, sourceFor(instanceId))) return null;
      return getBitmapRowIndices(s.source);
    },
    subscribeExternal(instanceId, callback) {
      const self = sourceFor(instanceId);
      const sub = rowSetSyncStore.subscribe(() => {
        const s = rowSetSyncStore.state;
        if (s.type === "empty") {
          if (s.source && sourcesEqual(s.source, self)) return; // self-originated clear → skip
          callback(null);
          return;
        }
        if (sourcesEqual(s.source, self)) return; // self-originated active → skip
        callback(getBitmapRowIndices(s.source));
      });
      return () => sub.unsubscribe();
    },
  };
}

/** Process-wide row-set bus — one app-level row-set mirror. */
export const rowSetBus: RowSetBus = createRowSetBus();
