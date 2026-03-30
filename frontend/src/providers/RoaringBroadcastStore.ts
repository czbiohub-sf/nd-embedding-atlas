import { RoaringBitmap32 } from "roaring-wasm";
import type { PanelId } from "../lib/branded-types";

/**
 * Singleton Roaring bitmaps per panel — reused across readbacks to avoid
 * WASM heap churn. RoaringBitmap32 instances are NOT GC'd automatically;
 * call disposeBitmap() on panel destroy to release WASM memory.
 *
 * Stores ROW INDICES (DuckDB __row_index__ values), not GPU buffer point indices.
 * The rowIndicesRef mapping (pointIndex → rowIndex) must happen before calling
 * updateBroadcastBitmap.
 */
const panelBitmaps = new Map<PanelId, RoaringBitmap32>();

export function getOrCreateBitmap(panelId: PanelId): RoaringBitmap32 {
  if (!panelBitmaps.has(panelId)) {
    panelBitmaps.set(panelId, new RoaringBitmap32());
  }
  // biome-ignore lint/style/noNonNullAssertion: just set above
  return panelBitmaps.get(panelId)!;
}

export function updateBroadcastBitmap(panelId: PanelId, rowIds: number[]): RoaringBitmap32 {
  const bm = getOrCreateBitmap(panelId);
  bm.clear();
  if (rowIds.length > 0) bm.addMany(rowIds);
  return bm;
}

export function disposeBitmap(panelId: PanelId): void {
  const bm = panelBitmaps.get(panelId);
  if (bm) {
    bm.dispose();
    panelBitmaps.delete(panelId);
  }
}

/** Get the row IDs currently in a panel's bitmap. */
export function getBitmapRowIds(panelId: PanelId): number[] {
  return panelBitmaps.get(panelId)?.toArray() ?? [];
}
