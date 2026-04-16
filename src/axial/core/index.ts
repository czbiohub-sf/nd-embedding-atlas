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
  NullableArray,
  CategoricalArray,
  AnnDataFrame,
  ColumnData,
  Convention,
  Scalar,
  Slice,
  SparseArray,
  TypedArrayFor,
  ZarrGroupLike,
} from "./types.ts";

export { slice, DEFAULT_CONFIG } from "./types.ts";
export { SimpleCoordArray, SimpleCoordSet } from "./coord-set.ts";
export { SimpleDataTree } from "./data-tree.ts";
export { CsrCscArray } from "./sparse.ts";
export { SimpleCategorical, SimpleNullable } from "./categorical.ts";
export { AnnDataAccessor } from "./anndata-accessor.ts";
export type { DenseResult, MatrixResult } from "./anndata-accessor.ts";
export { toArrowTable } from "./to-arrow.ts";
export { WorkerPool } from "./worker-pool.ts";
export type { WorkerPoolOptions } from "./worker-pool.ts";
export {
  streamFromGenerator,
  directStream,
  mapTransform,
  filterTransform,
  batchTransform,
  collect,
  count,
  take,
  streamDataFrameBatches,
} from "./streams.ts";
export type { ArrayChunk, DataFrameBatch, ArrowBatch } from "./streams.ts";
