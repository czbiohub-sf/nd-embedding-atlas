/**
 * axial — Labeled N-D arrays for scientific computing in TypeScript.
 *
 * Read OME-Zarr, AnnData, MuData, and xarray Zarr stores
 * with labeled dimensions, lazy evaluation, and named-axis algebra.
 */

// Core types
export type {
  AxialConfig,
  CoordArray,
  CoordSet,
  DataArray,
  DataTree,
  Dataset,
  DimName,
  Dtype,
  EncodingType,
  IndexSelector,
  LabelSelector,
  LazyDataArray,
  MaterializedDataArray,
  MultimodalDataset,
  CategoricalArray,
  NullableArray,
  AnnDataFrame,
  ColumnData,
  Convention,
  Scalar,
  Slice,
  SparseArray,
  ZarrGroupLike,
} from "./core/index.ts";

// Core constructors & utilities
export {
  slice,
  DEFAULT_CONFIG,
  SimpleCoordArray,
  SimpleCoordSet,
  SimpleDataTree,
  CsrCscArray,
  SimpleCategorical,
  SimpleNullable,
  AnnDataAccessor,
  toArrowTable,
  WorkerPool,
} from "./core/index.ts";

export type { DenseResult, MatrixResult } from "./core/index.ts";

// Store opener (convention auto-detect)
export { open } from "./store/open.ts";
