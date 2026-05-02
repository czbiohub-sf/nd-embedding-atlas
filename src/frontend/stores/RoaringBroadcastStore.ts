import { RoaringBitmap32 } from "roaring-wasm";
import { type SelectionSource, sourceKey } from "./SelectionSource";

/**
 * Singleton Roaring bitmaps per source — reused across readbacks to avoid
 * WASM heap churn. RoaringBitmap32 instances are NOT GC'd automatically;
 * call disposeBitmap() on panel destroy / collection deactivate to release
 * WASM memory.
 *
 * Stores ROW INDICES (DuckDB __row_index__ values), not GPU buffer point indices.
 * The rowIndicesRef mapping (pointIndex → rowIndex) must happen before calling
 * updateBroadcastBitmap.
 */
const sourceBitmaps = new Map<string, RoaringBitmap32>();

export function getOrCreateBitmap(source: SelectionSource): RoaringBitmap32 {
  const key = sourceKey(source);
  let bm = sourceBitmaps.get(key);
  if (!bm) {
    bm = new RoaringBitmap32();
    sourceBitmaps.set(key, bm);
  }
  return bm;
}

export function updateBroadcastBitmap(source: SelectionSource, rowIds: number[]): RoaringBitmap32 {
  const bm = getOrCreateBitmap(source);
  bm.clear();
  if (rowIds.length > 0) bm.addMany(rowIds);
  return bm;
}

export function disposeBitmap(source: SelectionSource): void {
  const key = sourceKey(source);
  const bm = sourceBitmaps.get(key);
  if (bm) {
    bm.dispose();
    sourceBitmaps.delete(key);
  }
}

/** Get the row IDs currently in a source's bitmap. */
export function getBitmapRowIds(source: SelectionSource): number[] {
  return sourceBitmaps.get(sourceKey(source))?.toArray() ?? [];
}
