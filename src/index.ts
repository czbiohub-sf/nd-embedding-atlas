/**
 * nd-embedding-atlas
 *
 * Interactive browser-based dashboard linking AI embeddings
 * to source 5D (TCZYX) image data.
 */

// Re-export the axial zarr I/O surface actually consumed by callers.
export { open, AnnDataAccessor, toArrowTable } from "./zarr/index.ts";
export type {
    AnnDataFrame,
    ColumnData,
    CategoricalArray,
    NullableArray,
    SparseArray,
    AxialConfig,
} from "./zarr/index.ts";
