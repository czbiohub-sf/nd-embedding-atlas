/**
 * @ndea/zarr: AnnData, MuData, and OME-Zarr metadata, obsm and dense-column
 * reads, and the obs write-back. obs/var values are read by DuckDB through
 * the duckdb-zarr extension.
 */

// Public types consumed by server routes and startup.
export type { FrameMeta, ParsedStore, ParsedAnnData, ParsedMuData, ParsedOmeZarr } from "./types.ts";
export type { DatasetHandle, MatrixFormat } from "./anndata.ts";

import type { Readable } from "zarrita";
import { open } from "./open.ts";
import { AnnData } from "./anndata.ts";
import { MuData } from "./mudata.ts";

export { open };
export { AnnData };
export { MuData };
export { BunFileStore, openBunStore } from "./bun-store.ts";
export { commitObsColumns, type CommitReport, type ObsColumnInput } from "./write-obs.ts";

/**
 * One-call AnnData opener: resolves the store, detects the convention,
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
