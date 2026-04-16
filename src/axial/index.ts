/**
 * axial — labeled N-D arrays for OME-Zarr, AnnData, MuData, xarray stores.
 *
 * Originally a standalone library; now vendored into nd-embedding-atlas and
 * trimmed to the surface actually consumed by the server + CLI. If more of
 * the legacy API becomes useful, add it back from core/index.ts.
 */

// Public types consumed by server routes and startup.
export type {
    AnnDataFrame,
    ColumnData,
    CategoricalArray,
    NullableArray,
    SparseArray,
    AxialConfig,
} from "./core/types.ts";

// Public runtime API: open a store, read AnnData, convert to Arrow.
export { open } from "./store/open.ts";
export { AnnDataAccessor } from "./core/anndata-accessor.ts";
export { toArrowTable } from "./core/to-arrow.ts";
