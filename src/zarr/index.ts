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
export type { DatasetHandle, DenseResult, MatrixResult, ToDuckDBOptions } from "./anndata.ts";

// Public runtime API: open a store, read AnnData/MuData, convert to Arrow.
export { open } from "./open.ts";
export { AnnData } from "./anndata.ts";
export { MuData } from "./mudata.ts";
export { LazyDataFrame, toArrowTable } from "./data-frame.ts";
export { BunFileStore, openBunStore } from "./bun-store.ts";
export { ingestDataFrame, ingestDataFrames, arrowTypeToDuckDB, appendArrowValue } from "./duckdb-ingest.ts";
