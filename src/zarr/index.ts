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
    ZarrConfig,
} from "./types.ts";

// Public runtime API: open a store, read AnnData, convert to Arrow.
export { open } from "./open.ts";
export { AnnDataAccessor } from "./anndata-accessor.ts";
export { toArrowTable } from "./to-arrow.ts";
