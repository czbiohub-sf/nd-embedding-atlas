/**
 * BroadcastBus (PLUGIN-ARCHITECTURE §6) — the core seam for `publishRowSet`,
 * the GPU dim-mask broadcast used for cross-panel highlighting. Phase 0 forwards
 * to `SelectionSyncStore` (which writes the row ids into the per-source Roaring
 * bitmap in `RoaringBroadcastStore`), keyed by a `panel` source derived from the
 * instance id. Bitmap memory is released on instance teardown via `disposeFor`.
 */

import { broadcastSelection, clearSelectionSync } from "@/stores/SelectionSyncStore";
import { disposeBitmap, getBitmapRowIds } from "@/stores/RoaringBroadcastStore";
import { panelSource, type SelectionSource } from "@/stores/SelectionSource";
import { panelId } from "@/lib/branded-types";
import type { PluginInstanceId } from "@/core/plugin/host";

export interface BroadcastBus {
  /** Broadcast this instance's selected row ids (WASM bitmap + sync store). */
  publishRowSet(instanceId: PluginInstanceId, ids: number[]): void;
  /** Read back the row ids currently broadcast by this instance. */
  rowIds(instanceId: PluginInstanceId): number[];
  /** Clear the broadcast without disposing the bitmap (reusable). */
  clear(instanceId: PluginInstanceId): void;
  /** Release the instance's WASM bitmap on teardown. */
  disposeFor(instanceId: PluginInstanceId): void;
}

const sourceFor = (instanceId: PluginInstanceId): SelectionSource => panelSource(panelId(instanceId as string));

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
  };
}

/** Process-wide broadcast bus — one app-level selection mirror. */
export const broadcastBus: BroadcastBus = createBroadcastBus();
