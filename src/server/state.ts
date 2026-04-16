/**
 * Shared viewer state types for the server.
 *
 * Ports the Python `server/_state.py` dataclasses to TypeScript interfaces.
 */

import type { AnnDataAccessor } from "../axial/core/anndata-accessor.ts";
import type { EmbeddingStore } from "./store.ts";

/** Resolved spatial column names (from config or auto-detection). */
export interface SpatialColumns {
    fov: string | null;
    t: string | null;
    bbox: string | null;
    x: string | null;
    y: string | null;
}

/** Returns the set of columns that should be hidden from the Mosaic VIEW. */
export function spatialHiddenColumns(spatial: SpatialColumns | null): Set<string> {
    if (!spatial?.bbox) return new Set();
    return new Set([spatial.bbox]);
}

/** Returns all non-null spatial column names. */
export function spatialAllColumns(spatial: SpatialColumns | null): Set<string> {
    if (!spatial) return new Set();
    const cols = new Set<string>();
    for (const v of [spatial.fov, spatial.t, spatial.bbox, spatial.x, spatial.y]) {
        if (v != null) cols.add(v);
    }
    return cols;
}

/** Per-channel rendering configuration. */
export interface ChannelConfig {
    /** Hex color without '#', e.g. "FF0000". */
    color: string;
    contrast?: [number, number];
    visible?: boolean;
}

/** Per-dataset configuration. */
export interface DatasetConfig {
    path: string;
    platePath?: string;
    channels?: Record<string, ChannelConfig>;
}

/** Static per-session metadata for the /data endpoints. */
export interface DatasetMeta {
    obsColumnNames: string[];
    embeddingProps: Record<string, unknown>;
    hasPlate: boolean;
    plateMeta: Record<string, unknown> | null;
    defaultX: string;
    defaultY: string;
    idColumn: string;
    datasetKeys: string[] | null;
    datasetChannels: Record<string, Array<Record<string, unknown>>> | null;
}

/** All mutable server state for one viewer session. */
export interface ViewerState {
    store: EmbeddingStore;
    datasets: Map<string, DatasetConfig>;
    spatial: SpatialColumns | null;
    obsColumns: string[];
    port: number;
    availableObsmKeys: string[];
    loadingTasks: Map<string, Promise<void>>;
    loadErrors: Map<string, string>;
    /** axial accessors by dataset name — for loading obsm from zarr on demand. */
    accessors: Map<string, AnnDataAccessor>;
}
