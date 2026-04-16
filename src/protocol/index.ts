/**
 * Wire-format schemas and types shared by the ndea server and frontend.
 *
 * Single source of truth for anything that crosses the HTTP boundary:
 *   - POST body schemas (server validates with .safeParse; frontend types via z.infer)
 *   - Response schemas (frontend parses; backend returns z.infer-shaped objects)
 *   - Binary-blob header schemas (scatter endpoints)
 *   - WebSocket method map (future migration)
 */

import { z } from "zod";

// ─── Shared primitives ──────────────────────────────────────────────────────

/** Non-negative 32-bit integer, safe to interpolate into SQL after validation. */
const NonNegativeInt = z.number().int().nonnegative().finite();

// ─── POST body schemas ──────────────────────────────────────────────────────

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

// ─── Response schemas ──────────────────────────────────────────────────────

/** Embedding status response. */
export const EmbeddingStatusSchema = z.object({
  status: z.enum(["loading", "ready", "error"]),
  error: z.string().optional(),
});
export type EmbeddingStatus = z.infer<typeof EmbeddingStatusSchema>;

/** Obs spatial-column response (bbox sub-shape). */
export const ObsBboxSchema = z.object({
  y_min: z.number(),
  x_min: z.number(),
  y_max: z.number(),
  x_max: z.number(),
});
export type ObsBbox = z.infer<typeof ObsBboxSchema>;

/** Observation info response — matches /api/obs/{row_index}. */
export const ObsInfoSchema = z
  .object({
    fov_name: z.string(),
    t: z.number(),
    x: z.number(),
    y: z.number(),
    bbox: ObsBboxSchema.optional(),
    store_index: z.number().optional(),
  })
  .passthrough();
export type ObsInfo = z.infer<typeof ObsInfoSchema>;

/** Metadata response — matches /data/metadata.json. */
export const ObsmEntrySchema = z.object({
  prefix: z.string(),
  n_dims: z.number().nullable().optional(),
  loaded: z.boolean(),
});
export const SpatialMetaSchema = z.object({
  fov_col: z.string().nullable().optional(),
  t_col: z.string().nullable().optional(),
  bbox_col: z.string().nullable().optional(),
  x_col: z.string().nullable().optional(),
  y_col: z.string().nullable().optional(),
});
export const PlateChannelSchema = z.object({
  label: z.string(),
  color: z.string(),
  window: z.object({ start: z.number(), end: z.number(), min: z.number(), max: z.number() }),
});
export const PlateStoreSchema = z.object({
  mount: z.string(),
  name: z.string(),
  ome_version: z.enum(["0.4", "0.5"]),
});
export const MetadataSchema = z
  .object({
    version: z.string().optional(),
    props: z.object({
      data: z.object({
        id: z.string(),
        projection: z.object({ x: z.string(), y: z.string() }),
      }),
    }),
    database: z.object({ type: z.string(), uri: z.string().optional() }),
    obsm: z.record(z.string(), ObsmEntrySchema),
    obs_columns: z.array(z.string()).optional(),
    var_count: z.number().optional(),
    layers: z.array(z.string()).optional(),
    export_dir: z.string().optional(),
    spatial: SpatialMetaSchema.optional(),
    plate: z.boolean().optional(),
    dataset_keys: z.array(z.string()).optional(),
    plate_ome_version: z.enum(["0.4", "0.5"]).optional(),
    plate_pixel_scale: z.object({ x: z.number(), y: z.number() }).optional(),
    plate_channels: z.array(PlateChannelSchema).optional(),
    dataset_channels: z.record(z.string(), z.array(PlateChannelSchema)).optional(),
    plate_stores: z.array(PlateStoreSchema).optional(),
    plate_shape: z.array(z.number()).optional(),
    plate_scale: z.array(z.number()).optional(),
    time_points: z.array(z.number()).optional(),
  })
  .passthrough();
export type Metadata = z.infer<typeof MetadataSchema>;

/** Viewer config response. */
export interface ConfigRes {
  datasets: Record<string, unknown>;
  spatial: Record<string, unknown> | null;
  obsColumns: string[];
  availableObsmKeys: string[];
  [key: string]: unknown;
}

/** ObsSet response row from /api/obssets listing. */
export const ObsSetSchema = z.object({
  obsset_id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  created_count: z.number(),
  current_count: z.number(),
  created_at: z.string(),
});
export type ObsSet = z.infer<typeof ObsSetSchema>;

// ─── Binary-blob header schemas (scatter endpoints) ─────────────────────────

/**
 * GET /api/scatter-positions — binary format:
 *   byte 0       version (uint8) = 1
 *   bytes 1..4   header_len (uint32 LE)
 *   bytes 5..    JSON header (this shape) + padding + Float32Array[positions]
 */
export const PositionHeaderSchema = z.object({
  numCells: z.number().int().positive(),
  embeddingKey: z.string().min(1),
  ndim: z.literal(2),
  rowIndices: z.array(z.number().int().nonnegative()),
  positionScale: z.number().positive().default(1),
});
export type PositionHeader = z.infer<typeof PositionHeaderSchema>;

/** GET /api/scatter-categories — header preceding Uint8Array[categoryIndex]. */
export const CategoryHeaderSchema = z.object({
  categoryNames: z.array(z.string()),
});
export type CategoryHeader = z.infer<typeof CategoryHeaderSchema>;

/** GET /api/scatter-continuous-colors — header preceding Uint8Array[rgba]. */
export const ContinuousColorsHeaderSchema = z.object({
  numPoints: z.number().int().positive(),
  vmin: z.number(),
  vmax: z.number(),
  colormap: z.string().min(1),
});
export type ContinuousColorsHeader = z.infer<typeof ContinuousColorsHeaderSchema>;

// ─── WebSocket protocol map (future migration) ──────────────────────────────

/** Mosaic query request — mirrors MosaicQueryBodySchema as a plain interface. */
export interface MosaicQueryReq {
  type: "arrow" | "json" | "exec";
  sql: string;
}

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
    res: Metadata;
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
    res: EmbeddingStatus;
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
    res: ObsInfo;
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
    res: ObsSet[];
  };
  "obssets/create": {
    req: {
      name: string;
      color?: string;
      members: { dataset_key: string; obs_name: string }[];
    };
    res: ObsSet;
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
