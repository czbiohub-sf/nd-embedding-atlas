/**
 * WebSocket Protocol Types for future WS migration.
 *
 * Defines the typed protocol map for all ndea server methods.
 * The frontend currently uses HTTP fetch() — these types will be
 * used when migrating to the axial WebSocket data protocol.
 */

import type { ProtocolMap } from "../axial/net/protocol.ts";

/** Mosaic query request. */
export interface MosaicQueryReq {
    type: "arrow" | "json" | "exec";
    sql: string;
}

/** Metadata response shape (matches /data/metadata.json). */
export interface MetadataRes {
    version?: string;
    props: Record<string, unknown>;
    database: { type: string };
    obsm: Record<string, { prefix: string; n_dims: number | null; loaded: boolean }>;
    obs_columns: string[];
    var_count: number;
    layers: string[];
    export_dir: string;
    spatial: {
        fov_col: string | null;
        t_col: string | null;
        bbox_col: string | null;
        x_col: string | null;
        y_col: string | null;
    };
    plate: boolean;
    dataset_keys?: string[];
    plate_channels?: Array<Record<string, unknown>>;
    dataset_channels?: Record<string, Array<Record<string, unknown>>>;
    plate_stores?: Array<{ mount: string; name: string; ome_version: string }>;
    [key: string]: unknown;
}

/** Viewer config response. */
export interface ConfigRes {
    datasets: Record<string, unknown>;
    spatial: Record<string, unknown> | null;
    obsColumns: string[];
    availableObsmKeys: string[];
    [key: string]: unknown;
}

/** Embedding status response. */
export interface EmbeddingStatusRes {
    status: "loading" | "ready" | "error" | "not_started";
    error?: string;
}

/** Observation info response. */
export interface ObsInfoRes {
    fov_name?: string;
    t: number;
    x?: number;
    y?: number;
    bbox?: { y_min: number; x_min: number; y_max: number; x_max: number };
    store_index?: number;
    [key: string]: unknown;
}

/**
 * NDEA WebSocket Protocol — typed method map.
 *
 * Each key is a WS message type, with typed request/response shapes.
 * Methods with `stream: true` return chunked binary responses.
 */
export interface NdeaProtocol extends ProtocolMap {
    "mosaic/query": {
        req: MosaicQueryReq;
        res: Record<string, unknown>[] | void;
        stream: true;
    };
    meta: {
        req: Record<string, never>;
        res: MetadataRes;
    };
    config: {
        req: Record<string, never>;
        res: ConfigRes;
    };
    "embeddings/load": {
        req: { key: string };
        res: { status: string };
    };
    "embeddings/status": {
        req: { key: string };
        res: EmbeddingStatusRes;
    };
    "scatter/positions": {
        req: { embedding: string; x_col: string; y_col: string };
        res: void;
        stream: true;
    };
    "scatter/categories": {
        req: { cat_col: string; original_col?: string };
        res: void;
        stream: true;
    };
    "scatter/continuous-colors": {
        req: { color_col: string; colormap: string; vmin?: number; vmax?: number };
        res: void;
        stream: true;
    };
    "obs/info": {
        req: { row_index: number };
        res: ObsInfoRes;
    };
    "obs/detail": {
        req: { row_index: number };
        res: Record<string, string | null>;
    };
    "obs/batch": {
        req: { ids: number[] };
        res: Record<string, { x: number; y: number }>;
    };
    "var/names": {
        req: { q?: string; limit?: number };
        res: { names: string[] };
    };
    "var/layers": {
        req: Record<string, never>;
        res: { layers: string[] };
    };
    "gene-column/load": {
        req: { gene: string; layer: string };
        res: { task_id: string; status: string; column: string };
    };
    "gene-column/status": {
        req: { task_id: string };
        res: { status: string; column?: string; error?: string };
    };
    "obssets/list": {
        req: Record<string, never>;
        res: Array<Record<string, unknown>>;
    };
    "obssets/create": {
        req: { name: string; color?: string; members: Array<{ dataset_key: string; obs_name: string }> };
        res: Record<string, unknown>;
    };
    "obssets/delete": {
        req: { obsset_id: string };
        res: { deleted: string };
    };
    "obssets/activate": {
        req: { obsset_id: string };
        res: { predicate: string };
    };
    "export/start": {
        req: { predicate: string; filename: string; selection_type?: string; embedding_key?: string };
        res: { task_id: string; status: string };
    };
    "export/status": {
        req: { task_id: string };
        res: { status: string; output_path?: string; n_obs?: number; error?: string };
    };
}
