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
import type { Readable } from "zarrita";
import { open } from "./open.ts";
import { AnnData } from "./anndata.ts";
import { MuData } from "./mudata.ts";

export { open };
export { AnnData };
export { MuData };
export { LazyDataFrame, toArrowTable } from "./data-frame.ts";
export { BunFileStore, openBunStore } from "./bun-store.ts";
export { commitObsColumns, type CommitReport, type ObsColumnInput } from "./write-obs.ts";
export {
  ingestDataFrame,
  ingestDataFrames,
  ingestDataFramesStreaming,
  ingestDataFrameChunked,
  arrowTypeToDuckDB,
  appendArrowValue,
} from "./duckdb-ingest.ts";

/**
 * One-call AnnData opener — resolves the store, detects the convention,
 * narrows the result. Replaces the static `AnnData.open()` facade that
 * created a circular import (anndata.ts → open.ts → anndata.ts).
 */
export async function openAnnData(location: string | Readable): Promise<AnnData> {
  const parsed = await open(location);
  if (parsed.kind !== "anndata") {
    throw new Error(`openAnnData: store is ${parsed.kind}, not AnnData. Use openMuData for MuData stores.`);
  }
  return AnnData.from(parsed);
}

export async function openMuData(location: string | Readable): Promise<MuData> {
  const parsed = await open(location);
  if (parsed.kind !== "mudata") {
    throw new Error(`openMuData: store is ${parsed.kind}, not MuData. Use openAnnData for AnnData stores.`);
  }
  return MuData.from(parsed);
}
