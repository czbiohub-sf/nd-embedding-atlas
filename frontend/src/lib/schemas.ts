import { z } from "zod";

export const ObsmEntrySchema = z.object({
  prefix: z.string(),
  n_dims: z.number().nullable().optional(),
  loaded: z.boolean(),
});

export const SpatialSchema = z
  .object({
    fov_col: z.string().nullable().optional(),
    t_col: z.string().nullable().optional(),
    bbox_col: z.string().nullable().optional(),
    x_col: z.string().nullable().optional(),
    y_col: z.string().nullable().optional(),
  })
  .optional();

const PlateChannelSchema = z.object({
  label: z.string(),
  color: z.string(),
  window: z.object({ start: z.number(), end: z.number(), min: z.number(), max: z.number() }),
});

const PlateStoreSchema = z.object({
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
    spatial: SpatialSchema,
    plate: z.boolean().optional(),
    dataset_keys: z.array(z.string()).optional(),
    plate_ome_version: z.enum(["0.4", "0.5"]).optional(),
    plate_pixel_scale: z.object({ x: z.number(), y: z.number() }).optional(),
    plate_channels: z.array(PlateChannelSchema).optional(),
    plate_stores: z.array(PlateStoreSchema).optional(),
    plate_shape: z.array(z.number()).optional(),
    plate_scale: z.array(z.number()).optional(),
    time_points: z.array(z.number()).optional(),
  })
  .passthrough(); // forward-compatible

const ObsBboxSchema = z.object({
  y_min: z.number(),
  x_min: z.number(),
  y_max: z.number(),
  x_max: z.number(),
});

// Matches the actual /api/obs/{row_index} response shape from the backend.
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

export const EmbeddingStatusSchema = z.object({
  status: z.enum(["loading", "ready", "error"]),
  error: z.string().optional(),
});

export const ObsSetSchema = z.object({
  obsset_id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  created_count: z.number(),
  current_count: z.number(),
  created_at: z.string(),
});

export type Metadata = z.infer<typeof MetadataSchema>;
export type ObsInfo = z.infer<typeof ObsInfoSchema>;
export type EmbeddingStatus = z.infer<typeof EmbeddingStatusSchema>;
export type ObsSet = z.infer<typeof ObsSetSchema>;
