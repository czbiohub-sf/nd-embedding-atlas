/**
 * nd-embedding-atlas
 *
 * Interactive browser-based dashboard linking AI embeddings
 * to source 5D (TCZYX) image data.
 */

// Phase 1a: axial I/O library for zarr/AnnData/MuData reading
export { open } from "./axial/store/open.ts";
export { AnnDataAccessor } from "./axial/core/anndata-accessor.ts";
export { toArrowTable } from "./axial/core/to-arrow.ts";
export type {
  DataTree,
  AnnDataFrame,
  ColumnData,
  CategoricalArray,
  NullableArray,
  SparseArray,
  Dataset,
  MultimodalDataset,
  CoordArray,
  CoordSet,
  Convention,
  Dtype,
  Scalar,
  Slice,
  AxialConfig,
} from "./axial/core/types.ts";
export type { DenseResult, MatrixResult } from "./axial/core/anndata-accessor.ts";
