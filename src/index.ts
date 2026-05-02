/**
 * nd-embedding-atlas
 *
 * Interactive browser-based dashboard linking AI embeddings
 * to source 5D (TCZYX) image data.
 */

// Re-export the zarr I/O surface actually consumed by callers.
export { open, AnnData, MuData, toArrowTable } from "./zarr/index.ts";
export type {
  AnnDataFrame,
  ColumnData,
  CategoricalArray,
  NullableArray,
  SparseArray,
  ParsedStore,
  ParsedAnnData,
  ParsedMuData,
  ParsedOmeZarr,
  DatasetHandle,
} from "./zarr/index.ts";
