/**
 * Wire-format schemas and types shared by the ndea server and frontend.
 * Single source of truth: Zod schemas + their inferred types + HTTP response
 * shapes + the WebSocket method map.
 *
 * Server imports `*Schema` to validate incoming request bodies.
 * Frontend imports inferred types (`CropBody`, etc.) and is free to reach
 * for the same Zod runtime if it wants client-side validation.
 */

import { z } from "zod";

// ─── Shared primitives ──────────────────────────────────────────────────────

/** Non-negative 32-bit integer, safe to interpolate into SQL after validation. */
const NonNegativeInt = z.number().int().nonnegative().finite();

// ─── Request-body schemas (per POST route) ──────────────────────────────────

/** POST /data/query — Mosaic SQL passthrough. Discriminated on `type`. */
export const MosaicQueryBodySchema = z.object({
    type: z.enum(["arrow", "json", "exec"]),
    sql: z.string().min(1),
});
export type MosaicQueryBody = z.infer<typeof MosaicQueryBodySchema>;

/** POST /api/crop/{fovPath} — image crop request. */
export const CropChannelSchema = z.object({
    visible: z.boolean().optional(),
    lo: z.number().finite().optional(),
    hi: z.number().finite().optional(),
    color: z.string().optional(),
    /** Frontend sends `blend` (blend mode) for layer compositing. */
    blend: z.string().optional(),
});
export const CropBodySchema = z.object({
    t: z.number().int().optional(),
    z: z.number().int().optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    half: z.number().int().positive().optional(),
    size: z.number().int().positive().optional(),
    fmt: z.string().optional(),
    quality: z.number().finite().optional(),
    dataset_key: z.string().optional(),
    channels: z.array(CropChannelSchema).max(32).optional(),
});
export type CropBody = z.infer<typeof CropBodySchema>;

/** POST /api/export — start async export. Frontend may send embedding_key: null. */
export const ExportBodySchema = z.object({
    predicate: z.string().min(1),
    filename: z.string().optional(),
    output_path: z.string().optional(),
    selection_type: z.string().optional(),
    embedding_key: z.string().nullable().optional(),
});
export type ExportBody = z.infer<typeof ExportBodySchema>;

/** POST /api/obssets — create a new observation set. */
export const ObsSetMemberSchema = z.object({
    dataset_key: z.string(),
    obs_name: z.string(),
});
export const CreateObsSetBodySchema = z.object({
    name: z.string().min(1),
    color: z.string().nullable().optional(),
    members: z.array(ObsSetMemberSchema).optional(),
});
export type CreateObsSetBody = z.infer<typeof CreateObsSetBodySchema>;

/**
 * POST /api/scatter-selection — upload selected row indices.
 *
 * SECURITY: row_indices are interpolated into SQL (`VALUES (${i})`).
 * Each element must be a non-negative integer; total array capped at 1M.
 */
export const ScatterSelectionBodySchema = z.object({
    row_indices: z.array(NonNegativeInt).max(1_000_000),
});
export type ScatterSelectionBody = z.infer<typeof ScatterSelectionBodySchema>;

/** POST /api/gene-column — start gene column materialization. */
export const GeneColumnBodySchema = z.object({
    gene: z.string().min(1),
    layer: z.string().optional(),
});
export type GeneColumnBody = z.infer<typeof GeneColumnBodySchema>;

// ─── HTTP response shapes ───────────────────────────────────────────────────

/** Mosaic query request — mirrors MosaicQueryBodySchema as a plain interface. */
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

// ─── WebSocket protocol map ─────────────────────────────────────────────────

/**
 * Typed WebSocket-style method map. Keys are method names, values declare
 * request/response shapes. `stream: true` indicates chunked binary responses.
 */
export interface ProtocolMap {
    [method: string]: {
        req: unknown;
        res: unknown;
        stream?: boolean;
    };
}

/** ndea WebSocket method map — typed req/res shapes keyed by method name. */
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
        req: {
            name: string;
            color?: string;
            members: Array<{ dataset_key: string; obs_name: string }>;
        };
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
        req: {
            predicate: string;
            filename: string;
            selection_type?: string;
            embedding_key?: string;
        };
        res: { task_id: string; status: string };
    };
    "export/status": {
        req: { task_id: string };
        res: { status: string; output_path?: string; n_obs?: number; error?: string };
    };
}
