/**
 * zarr — labeled N-D array reader for OME-Zarr, AnnData, MuData, xarray stores.
 *
 * Originally a standalone library called "axial"; now vendored into
 * nd-embedding-atlas and trimmed to the surface actually consumed.
 */

// Public types consumed by server routes and startup.
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
} from "./types.ts";
export type { DataFrame } from "./data-frame.ts";
export type { DenseResult, MatrixResult } from "./anndata-accessor.ts";

// Public runtime API: open a store, read AnnData, convert to Arrow.
export { open } from "./open.ts";
export { AnnData } from "./anndata-class.ts";
export { LazyDataFrame } from "./data-frame.ts";
export { BunFileStore, openBunStore } from "./bun-store.ts";
export { toArrowTable } from "./to-arrow.ts";
export { ingestDataFrame, ingestDataFrames, arrowTypeToDuckDB, appendArrowValue } from "./to-duckdb.ts";
