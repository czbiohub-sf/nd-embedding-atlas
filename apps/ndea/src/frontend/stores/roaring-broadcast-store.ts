import { RoaringBitmap32 } from "roaring-wasm";
import type { RowIndex } from "@ndea/sdk";
import { type RowSetSource, sourceKey } from "./row-set-source";

/**
 * Singleton Roaring bitmaps per source — reused across readbacks to avoid
 * WASM heap churn. RoaringBitmap32 instances are NOT GC'd automatically;
 * call disposeBitmap() when a source deactivates to release
 * WASM memory.
 *
 * Stores ROW INDICES (DuckDB __row_index__ values), not GPU buffer point indices.
 * The rowIndicesRef mapping (pointIndex → rowIndex) must happen before calling
 * updateBroadcastBitmap.
 */
const sourceBitmaps = new Map<string, RoaringBitmap32>();

export function getOrCreateBitmap(source: RowSetSource): RoaringBitmap32 {
  const key = sourceKey(source);
  let bm = sourceBitmaps.get(key);
  if (!bm) {
    bm = new RoaringBitmap32();
    sourceBitmaps.set(key, bm);
  }
  return bm;
}

export function updateBroadcastBitmap(source: RowSetSource, rowIndices: RowIndex[]): RoaringBitmap32 {
  const bm = getOrCreateBitmap(source);
  bm.clear();
  if (rowIndices.length > 0) bm.addMany(rowIndices);
  return bm;
}

export function disposeBitmap(source: RowSetSource): void {
  const key = sourceKey(source);
  const bm = sourceBitmaps.get(key);
  if (bm) {
    bm.dispose();
    sourceBitmaps.delete(key);
  }
}

/** Get the row indices currently in a source's bitmap. */
export function getBitmapRowIndices(source: RowSetSource): RowIndex[] {
  return (sourceBitmaps.get(sourceKey(source))?.toArray() ?? []) as RowIndex[];
}
