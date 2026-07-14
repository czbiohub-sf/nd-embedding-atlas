/**
 * Wire-format schemas and types shared across ndea workspaces.
 *
 * Single source of truth for anything that crosses the HTTP boundary:
 *   - POST body schemas (server validates with .safeParse; frontend types via z.infer)
 *   - Response schemas (frontend parses; backend returns z.infer-shaped objects)
 *   - Binary-blob header schemas (scatter endpoints)
 *   - WebSocket method map (future migration)
 *
 * # Threat model (v1)
 *
 * ndea today is a single-user local tool — collection authors are trusted,
 * the only client is the same process tree that owns the data. The
 * `CollectionNameSchema` / `TagSchema` regex below excludes control chars,
 * the HTML metas `<>&`, and Unicode bidi overrides `‪-‮` as
 * defense-in-depth. JSX escapes them at render today, but disallowing
 * them here means a future markdown / dangerouslySetInnerHTML pass cannot
 * silently turn these strings into a script vector without also widening
 * this schema.
 *
 * **Re-run security review** when any of these change:
 *   1. collections become shareable between users / sessions
 *   2. a sync/import path accepts collections from disk or network
 *   3. notes/provenance render as anything other than escaped text
 */

import { z } from "zod";

export {
  PLUGIN_BOOTSTRAP_SCHEMA_VERSION,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PluginBootstrapCatalogSchema,
  PluginBootstrapEntrySchema,
  PluginBootstrapSchemaVersionSchema,
  PluginDiagnosticSchema,
  PluginDiagnosticSeveritySchema,
  PluginDiagnosticStageSchema,
  PluginHostCompatibilitySchema,
  PluginIdSchema,
  PluginManifestSchema,
  PluginManifestSchemaVersionSchema,
  PluginPackageVersionSchema,
  PluginPermissionDisclosureSchema,
  PluginPermissionSchema,
  PluginPlatformSchema,
  SDKVersionRangeSchema,
} from "./plugin";
export type {
  PluginBootstrapCatalog,
  PluginBootstrapEntry,
  PluginBootstrapSchemaVersion,
  PluginDiagnostic,
  PluginDiagnosticSeverity,
  PluginDiagnosticStage,
  PluginHostCompatibility,
  PluginId,
  PluginManifest,
  PluginManifestSchemaVersion,
  PluginPackageVersion,
  PluginPermission,
  PluginPermissionDisclosure,
  PluginPlatform,
  SDKVersionRange,
} from "./plugin";

// ─── Shared primitives ──────────────────────────────────────────────────────

/** Non-negative 32-bit integer, safe to interpolate into SQL after validation. */
const NonNegativeInt = z.number().int().nonnegative();

// ─── POST body schemas ──────────────────────────────────────────────────────

/** POST /data/query — Mosaic SQL passthrough. Discriminated on `type`. */
export const MosaicQueryBodySchema = z.object({
  type: z.enum(["arrow", "json", "exec"]),
  sql: z.string().min(1),
});
export type MosaicQueryBody = z.infer<typeof MosaicQueryBodySchema>;

/** POST /api/crop/{fovPath} — image crop request. */
export const CropChannelSchema = z.object({
  /**
   * Zero-based zarr C-axis index this channel draws from. Optional for
   * backward compat — when omitted, the server falls back to the channel's
   * position in the array. Send explicitly so a future channel-reorder UI
   * doesn't silently swap clims/colors when the array order diverges from
   * the underlying C dimension.
   */
  cIndex: z.number().int().nonnegative().optional(),
  visible: z.boolean().optional(),
  lo: z.number().optional(),
  hi: z.number().optional(),
  color: z.string().optional(),
  /** Frontend sends `blend` (blend mode) for layer compositing. */
  blend: z.string().optional(),
});
export const CropBodySchema = z.object({
  t: z.number().int().optional(),
  z: z.number().int().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  half: z.number().int().positive().optional(),
  size: z.number().int().positive().optional(),
  quality: z.number().optional(),
  dataset_key: z.string().optional(),
  channels: z.array(CropChannelSchema).max(32).optional(),
});
export type CropBody = z.infer<typeof CropBodySchema>;

/**
 * GET /api/channel-stats/{fov} — per-channel pixel statistics for autocontrast.
 * Computed once per FOV from the coarsest pyramid level, server-cached.
 * `lo`/`hi` are the saturation-percentile limits (Fiji-style); `dataMin`/`dataMax`
 * are the raw extent (napari-style min–max). The frontend derives display limits
 * from whichever method is selected — both ship in one response, so toggling the
 * method never re-fetches. `bins` is a 256-bin histogram for the levels display.
 */
export const ChannelStatSchema = z.object({
  lo: z.number(),
  hi: z.number(),
  dataMin: z.number(),
  dataMax: z.number(),
  bins: z.array(z.number()),
});
export type ChannelStat = z.infer<typeof ChannelStatSchema>;
export const ChannelStatsResponseSchema = z.object({
  channels: z.array(ChannelStatSchema),
});

/** POST /api/export — start async export. Frontend may send embedding_key: null. */
export const ExportBodySchema = z.object({
  predicate: z.string().min(1),
  filename: z.string().optional(),
  output_path: z.string().optional(),
  selection_type: z.string().optional(),
  embedding_key: z.string().nullable().optional(),
});
export type ExportBody = z.infer<typeof ExportBodySchema>;

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

/** POST /api/var-column — start materialization of a var (feature) column. */
export const VarColumnBodySchema = z.object({
  name: z.string().min(1),
  layer: z.string().optional(),
  /** MuData modality (e.g. "rna"). Ignored for plain AnnData stores. */
  modality: z.string().optional(),
});
export type VarColumnBody = z.infer<typeof VarColumnBodySchema>;

export const CategorizeBodySchema = z.object({
  column: z.string().min(1),
  maxCategories: z.number().int().positive().max(1024).optional(),
});
export type CategorizeBody = z.infer<typeof CategorizeBodySchema>;

export const CategoryLegendItemSchema = z.object({
  label: z.string(),
  index: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
});
export const CategorizeResponseSchema = z.object({
  indexColumn: z.string(),
  legend: z.array(CategoryLegendItemSchema),
  otherIndex: z.number().int().nonnegative(),
  nullIndex: z.number().int().nonnegative(),
});
export type CategoryLegendItem = z.infer<typeof CategoryLegendItemSchema>;
export type CategorizeResponse = z.infer<typeof CategorizeResponseSchema>;

// ─── Response schemas ──────────────────────────────────────────────────────

/** Embedding status response. */
export const EmbeddingStatusSchema = z.object({
  status: z.enum(["not_started", "loading", "ready", "error"]),
  error: z.string().optional(),
  n_dims: NonNegativeInt.optional(),
});
export type EmbeddingStatus = z.infer<typeof EmbeddingStatusSchema>;

/** Common JSON error envelope returned by HTTP routes. */
export const ErrorResponseSchema = z.looseObject({
  error: z.string(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** GET /api/export-dir response. */
export const ExportDirectoryResponseSchema = z.object({
  default_dir: z.string(),
  writable: z.boolean(),
});
export type ExportDirectoryResponse = z.infer<typeof ExportDirectoryResponseSchema>;

/** Successful POST /api/collections/:id/export response. */
export const CollectionExportResponseSchema = z.object({
  output_path: z.string(),
  n_obs: NonNegativeInt,
  size_bytes: NonNegativeInt,
  format: z.enum(["csv", "parquet"]),
});
export type CollectionExportResponse = z.infer<typeof CollectionExportResponseSchema>;

/** File-exists POST /api/collections/:id/export response. */
export const CollectionExportConflictResponseSchema = z.object({
  error: z.literal("File exists"),
  existing_path: z.string(),
  existing_size_bytes: NonNegativeInt,
});
export type CollectionExportConflictResponse = z.infer<typeof CollectionExportConflictResponseSchema>;

/** GET /api/var/names response. */
export const VarNamesResponseSchema = z.object({
  names: z.array(z.string()),
});
export type VarNamesResponse = z.infer<typeof VarNamesResponseSchema>;

/** GET /api/var/layers response. */
export const VarLayersResponseSchema = z.object({
  layers: z.array(z.string()),
});
export type VarLayersResponse = z.infer<typeof VarLayersResponseSchema>;

/** POST /api/var-column response. */
export const VarColumnResponseSchema = z.object({
  task_id: z.string(),
  status: z.enum(["loading", "ready"]),
  column: z.string(),
});
export type VarColumnResponse = z.infer<typeof VarColumnResponseSchema>;

/** GET /api/var-column/:task_id/status and var-column/status WebSocket response. */
export const VarColumnStatusResponseSchema = z.object({
  status: z.enum(["loading", "ready", "error"]),
  column: z.string(),
  error: z.string().optional(),
});
export type VarColumnStatusResponse = z.infer<typeof VarColumnStatusResponseSchema>;

/** POST /api/selection/:instance_id response. */
export const SelectionPublishResponseSchema = z.object({
  ok: z.literal(true),
  table: z.string(),
  count: NonNegativeInt,
});
export type SelectionPublishResponse = z.infer<typeof SelectionPublishResponseSchema>;

/** Obs spatial-column response (bbox sub-shape). */
export const ObsBboxSchema = z.object({
  y_min: z.number(),
  x_min: z.number(),
  y_max: z.number(),
  x_max: z.number(),
});
export type ObsBbox = z.infer<typeof ObsBboxSchema>;

/** Observation info response — matches /api/obs/{row_index}. */
export const ObsInfoSchema = z.looseObject({
  fov_name: z.string(),
  t: z.number(),
  x: z.number(),
  y: z.number(),
  bbox: ObsBboxSchema.optional(),
  store_index: z.number().optional(),
});
export type ObsInfo = z.infer<typeof ObsInfoSchema>;

/** Metadata response — matches /data/metadata.json. */
export const ObsmEntrySchema = z.object({
  prefix: z.string(),
  n_dims: z.number().nullable().optional(),
  loaded: z.boolean(),
  /** Modality name for MuData keys (e.g. "rna" for "rna:X_umap"). */
  modality: z.string().optional(),
});
export type ObsmEntry = z.infer<typeof ObsmEntrySchema>;
export const SpatialMetaSchema = z.object({
  fov_col: z.string().nullable().optional(),
  t_col: z.string().nullable().optional(),
  bbox_col: z.string().nullable().optional(),
  x_col: z.string().nullable().optional(),
  y_col: z.string().nullable().optional(),
});
export type SpatialMeta = z.infer<typeof SpatialMetaSchema>;
export const PlateChannelSchema = z.object({
  label: z.string(),
  color: z.string(),
  window: z.object({ start: z.number(), end: z.number(), min: z.number(), max: z.number() }),
});
export type PlateChannel = z.infer<typeof PlateChannelSchema>;
export const PlateStoreSchema = z.object({
  mount: z.string(),
  name: z.string(),
  ome_version: z.enum(["0.4", "0.5"]),
});
export type PlateStore = z.infer<typeof PlateStoreSchema>;

/**
 * Data-capability vocabulary (CAPABILITY-CONTRACT.md §3). One flat enum, the
 * single source of truth for "what shapes of data does this dataset provide."
 *
 * Computed server-side at open()/ingest and baked into `Metadata.capabilities`
 * below; the frontend reads it through `capabilitiesOf()` so every feature gate
 * speaks one vocabulary instead of ad-hoc `metadata.plate` / `obsm` checks. The
 * SAME set is the future xyflow node port-type (`requires ⊆ provides`).
 *
 * Flat first (set-membership, not parameterized) — `obsm:X_phate`-grained
 * discrimination is a structural-subtype extension deferred until a view needs
 * to target a specific embedding/channel. `obsp`/`temporal` are reserved here
 * but only emitted once their server-side detection (neighbor graph / tracks)
 * formalizes — see the §3.1 derivation table.
 */
export const DataCapabilitySchema = z.enum([
  "obs", // observation dataframe (effectively always present)
  "var", // variable dataframe (var_count > 0)
  "obsm", // embeddings (X_phate, X_pca, …) → scatter
  "obsp", // pairwise / neighbor graph → knn gallery, trajectory  [reserved]
  "spatial", // x/y coordinates → spatial overlays
  "plate-image", // HCS pixel data (OME-Zarr) → image viewer
  "multimodal", // MuData (rna + protein …)
  "temporal", // tracks / time series                             [reserved]
]);
export type DataCapability = z.infer<typeof DataCapabilitySchema>;

export const MetadataSchema = z.looseObject({
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
  /** Number for AnnData; per-modality map for MuData. */
  var_count: z.union([z.number(), z.record(z.string(), z.number())]).optional(),
  layers: z.array(z.string()).optional(),
  /** MuData modality names (absent for single AnnData). */
  modalities: z.array(z.string()).optional(),
  /** MuData per-modality obs column names. */
  modality_obs_columns: z.record(z.string(), z.array(z.string())).optional(),
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
  /**
   * Provided data capabilities (CAPABILITY-CONTRACT.md §3). Server-derived;
   * `.default([])` so an older payload parses to the empty set rather than
   * throwing — the single compiled binary version-locks this in practice.
   */
  /** Active preset name — a build resolves it to a bundled graph; default "annotate". */
  preset: z.string().optional(),
  capabilities: z.array(DataCapabilitySchema).default([]),
});
export type Metadata = z.infer<typeof MetadataSchema>;

/** Viewer config response. */
export const ConfigDatasetSchema = z.object({
  path: z.string(),
  platePath: z.string().nullable(),
});
export const ConfigSpatialSchema = z.object({
  fov: z.string().nullable(),
  t: z.string().nullable(),
  bbox: z.string().nullable(),
  x: z.string().nullable(),
  y: z.string().nullable(),
  z: z.string().nullable(),
});
export const ConfigResponseSchema = z.object({
  datasets: z.record(z.string(), ConfigDatasetSchema),
  spatial: ConfigSpatialSchema.nullable(),
  obsColumns: z.array(z.string()),
  availableObsmKeys: z.array(z.string()),
  loadedEmbeddings: z.array(z.string()),
  nObs: NonNegativeInt,
  port: NonNegativeInt,
});
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;

/** GET /api/trajectory response row. Serialized keys intentionally mix casing. */
export const TrajectoryFrameSchema = z.object({
  rowIndex: NonNegativeInt,
  t: z.number(),
  emb_x: z.number(),
  emb_y: z.number(),
  spatial_x: z.number(),
  spatial_y: z.number(),
  datasetKey: z.string().nullable(),
  category: z.number().optional(),
  z: z.number().optional(),
});
export type TrajectoryFrame = z.infer<typeof TrajectoryFrameSchema>;
export const TrajectoryResponseSchema = z.array(TrajectoryFrameSchema);
export type TrajectoryResponse = z.infer<typeof TrajectoryResponseSchema>;

// ─── Collections ─────────────────────────────────────────────────────────────
//
// Replaces the earlier row-group prototype. The schema adds tags (many-to-many),
// notes, optional provenance JSON (only set for derived collections),
// soft-delete + version (optimistic concurrency), and per-dataset drift
// breakdown in the list response.

/**
 * Trust-safe string regex: rejects control chars (\x00–\x1F, \x7F),
 * HTML metas (`<>&`), and Unicode bidi overrides (\u202A–\u202E).
 *
 * See the file header for the threat model + re-review triggers.
 */
// oxlint-disable-next-line no-control-regex -- intentional: this regex's job is to reject control chars + HTML metas + bidi overrides as render-safety defense.
const TRUST_SAFE_RE = /^[^\u0000-\u001f\u007f<>&\u202a-\u202e]+$/;

/**
 * CollectionNameSchema — shared primitive used by the wire body schemas
 * AND by frontend Field validation (re-export).
 *
 * 1..200 chars, trust-safe regex. Add stricter client-only rules in the
 * frontend by composing on top, not by widening this base.
 */
export const CollectionNameSchema = z.string().min(1).max(200).regex(TRUST_SAFE_RE, "Invalid character in name");

/** Tag — short, trust-safe regex, capped to keep sidecar small. */
const TagSchema = z.string().min(1).max(64).regex(TRUST_SAFE_RE, "Invalid character in tag");

/** Member identity: durable obs_name within a dataset_key. */
export const CollectionMemberSchema = z.object({
  dataset_key: z.string().min(1).max(256),
  obs_name: z.string().min(1).max(512),
});
export type CollectionMember = z.infer<typeof CollectionMemberSchema>;

/**
 * Members source — one of these three discriminators, shared by
 * CreateCollectionBodySchema (Create) and AppendMembersBodySchema (Append).
 *
 * Refined separately on each consuming schema since the .refine error
 * doesn't compose cleanly when split across .merge / .extend.
 */
const MembersSourceFields = {
  members: z.array(CollectionMemberSchema).max(2_000_000).optional(),
  row_indices: z.array(NonNegativeInt).max(2_000_000).optional(),
  /**
   * Read members from the existing `__scatter_selection` temp table —
   * tiny request body, server already has the indices in memory. Frontend
   * should POST `/api/scatter-selection` first to populate it.
   */
  from_scatter_selection: z.boolean().optional(),
} as const;

const MEMBERS_SOURCE_REFINE = "One of `members`, `row_indices`, or `from_scatter_selection: true` is required";
const hasMembersSource = (b: {
  members?: unknown[] | undefined;
  row_indices?: unknown[] | undefined;
  from_scatter_selection?: boolean | undefined;
}) =>
  (b.members != null && b.members.length > 0) ||
  (b.row_indices != null && b.row_indices.length > 0) ||
  b.from_scatter_selection === true;

/** POST /api/collections — create a new collection. */
export const CreateCollectionBodySchema = z
  .object({
    name: CollectionNameSchema,
    color: z.string().nullable().optional(),
    notes: z.string().max(4096).nullable().optional(),
    tags: z.array(TagSchema).max(32).default([]),
    ...MembersSourceFields,
    /** Optional structured recipe; only meaningful for derived sets. */
    provenance: z.unknown().optional(),
  })
  .refine(hasMembersSource, MEMBERS_SOURCE_REFINE);
export type CreateCollectionBody = z.infer<typeof CreateCollectionBodySchema>;

/**
 * POST /api/collections/:id/members — append members to an existing collection.
 *
 * Distinct from CreateCollectionBodySchema: no `name` (the collection
 * already exists), no `color`/`notes`/`tags` (those go through PATCH).
 * The append handler previously reused the create schema, which is why
 * older `useAddMembers` call sites had to pass `{name: "ignored"}` —
 * fixed by this split.
 */
export const AppendMembersBodySchema = z
  .object({
    ...MembersSourceFields,
  })
  .refine(hasMembersSource, MEMBERS_SOURCE_REFINE);
export type AppendMembersBody = z.infer<typeof AppendMembersBodySchema>;

/**
 * CollectionMutationResult — envelope returned by Create + Append.
 *
 * Contains the resulting collection plus dedupe accounting:
 *   - added:          new rows actually inserted
 *   - already_member: input rows that collided with existing PK
 *   - total:          sum (== input row count)
 *
 * Frontend uses these for the save toast: "Saved · 1,240 added, 87 already
 * in collection". PR3 set algebra returns a different envelope shape
 * (multiple collections, different stats) — name this one `Member*` so
 * `Set*` is free for that.
 */
export const MemberMutationStatsSchema = z.object({
  added: z.number().int().nonnegative(),
  already_member: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type MemberMutationStats = z.infer<typeof MemberMutationStatsSchema>;

/** PATCH /api/collections/:id — partial update with optimistic concurrency. */
export const PatchCollectionBodySchema = z.object({
  name: CollectionNameSchema.optional(),
  color: z.string().nullable().optional(),
  notes: z.string().max(4096).nullable().optional(),
  tags: z.array(TagSchema).max(32).optional(),
  /** Required — server rejects with 409 on mismatch. */
  version: z.number().int().nonnegative(),
});
export type PatchCollectionBody = z.infer<typeof PatchCollectionBodySchema>;

/**
 * POST /api/active-selection — set the active set composition.
 *
 * Today: `{collection_ids: [id]}` with one element. PR3 generalises to
 * `{ops: [{op:"union"|"intersect"|"subtract", id:"..."}, ...]}` for set
 * algebra without changing the route or response shape.
 *
 * The empty `collection_ids: []` body clears the active selection (same as
 * DELETE /api/active-selection).
 */
export const SetActiveSelectionBodySchema = z.object({
  collection_ids: z.array(z.uuid()).max(32),
});
export type SetActiveSelectionBody = z.infer<typeof SetActiveSelectionBodySchema>;

/**
 * Response from POST /api/active-selection.
 *
 * Contract is intentionally generic so PR3 multi-active set algebra fits
 * without a schema break. `token` rides in the predicate as an inline SQL
 * comment so Mosaic's SQL-text query cache busts on each set change
 * without needing a per-activation temp-table name.
 */
export const ActiveSelectionResponseSchema = z.object({
  token: z.string(),
  predicate: z.string(),
  resolved_count: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
});
export type ActiveSelectionResponse = z.infer<typeof ActiveSelectionResponseSchema>;

/** Per-dataset drift breakdown surfaced in list responses. */
export const CollectionDriftSchema = z.object({
  dataset_key: z.string(),
  stored: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
});
export type CollectionDrift = z.infer<typeof CollectionDriftSchema>;

/** GET /api/collections — list response row. */
export const CollectionSchema = z.object({
  collection_id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  provenance: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  created_count: z.number().int().nonnegative(),
  current_count: z.number().int().nonnegative(),
  drift: z.array(CollectionDriftSchema),
  version: z.number().int().nonnegative(),
});
export type Collection = z.infer<typeof CollectionSchema>;
export const CollectionListResponseSchema = z.array(CollectionSchema);
export type CollectionListResponse = z.infer<typeof CollectionListResponseSchema>;

/**
 * Envelope returned by POST /api/collections and POST /api/collections/:id/members.
 *
 * `result` carries the full Collection (post-mutation), `stats` carries
 * dedupe accounting. PR3 will introduce a sibling envelope for set-algebra
 * mutations (compose/derive) with a different `result` shape; this type
 * name reserves "Member*" for the member-mutation case.
 */
export const CollectionMutationResultSchema = z.object({
  result: CollectionSchema,
  stats: MemberMutationStatsSchema,
});
export type CollectionMutationResult = z.infer<typeof CollectionMutationResultSchema>;

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

/**
 * GET /api/scatter-continuous-values — header preceding Float32Array[values].
 *
 * Values are raw (un-normalized) — the GPU normalizes with (vmin, vmax) so that
 * a slider drag is a uniform write + re-dispatch, not a re-fetch. NaNs are
 * preserved; the GPU kernel maps them to mid-gradient.
 */
export const ContinuousValuesHeaderSchema = z.object({
  numPoints: z.number().int().positive(),
  vmin: z.number(),
  vmax: z.number(),
});
export type ContinuousValuesHeader = z.infer<typeof ContinuousValuesHeaderSchema>;

// ─── WebSocket protocol map ─────────────────────────────────────────────────

/** Implemented ndea WebSocket methods, typed by exact request/response DTOs. */
export interface NdeaProtocol {
  "embeddings/load": {
    req: { key: string };
    res: { status: string };
  };
  "embeddings/status": {
    req: { key: string };
    res: EmbeddingStatus;
  };
  "var-column/load": {
    req: VarColumnBody;
    res: VarColumnResponse;
  };
  "var-column/status": {
    req: { task_id: string };
    res: VarColumnStatusResponse;
  };
  "export/start": {
    req: ExportBody;
    res: { task_id: string; status: string };
  };
  "export/status": {
    req: { task_id: string };
    res: { status: string; output_path?: string; n_obs?: number; error?: string };
  };
}

// ─── Annotation schemas ──────────────────────────────────────────────────────

/**
 * Annotation/var column names flow into SQL as quoted identifiers. Unlike
 * TRUST_SAFE_RE (render-safety), this MUST exclude characters that are
 * dangerous inside a SQL identifier — above all the double-quote, which could
 * break out of `"…"` quoting. Allow letters, digits, space, underscore, dot,
 * hyphen; require a leading letter/digit/underscore. The SQL sink also escapes
 * via quoteIdent() (defense in depth), but rejecting at the door keeps weird
 * names out of table-name derivation and downstream tooling.
 */
const COLUMN_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9 _.-]*$/;

/**
 * Annotation column data type. `categorical`/`string` both stage as TEXT in
 * DuckDB (they differ only in on-disk AnnData encoding + how the frontend
 * colors them); `integer` stages as INTEGER and `float` as DOUBLE, both
 * colored continuously. `float` backs range annotations (a range is authored
 * as two float columns, `{name}_min` / `{name}_max`).
 */
export const AnnotationDtypeSchema = z.enum(["categorical", "string", "integer", "float"]);
export type AnnotationDtype = z.infer<typeof AnnotationDtypeSchema>;

/** One entry returned by GET /api/annotations/columns. */
export const AnnotationColumnSchema = z.object({
  name: z.string(),
  dtype: AnnotationDtypeSchema,
});
export type AnnotationColumn = z.infer<typeof AnnotationColumnSchema>;

/** GET /api/annotations/columns response. */
export const AnnotationColumnsResponseSchema = z.object({
  columns: z.array(AnnotationColumnSchema),
});
export type AnnotationColumnsResponse = z.infer<typeof AnnotationColumnsResponseSchema>;

/** Predicate branch of POST /api/annotations/values. */
export const AnnotationPredicateWriteResponseSchema = z.object({
  ok: z.literal(true),
  n: NonNegativeInt,
});
export type AnnotationPredicateWriteResponse = z.infer<typeof AnnotationPredicateWriteResponseSchema>;

/** POST /api/annotations/columns — create a new annotation column. */
export const AnnotationColumnBodySchema = z.object({
  name: z.string().min(1).max(200).regex(COLUMN_NAME_RE, "Invalid character in column name"),
  dtype: AnnotationDtypeSchema.default("categorical"),
});
export type AnnotationColumnBody = z.infer<typeof AnnotationColumnBodySchema>;

/** One value row for POST /api/annotations/values (explicit rows path). */
export const AnnotationValueRowSchema = z.object({
  rowIndex: NonNegativeInt,
  datasetKey: z.string().min(1).max(256),
  obsName: z.string().min(1).max(512),
  value: z.string().nullable(),
});
export type AnnotationValueRow = z.infer<typeof AnnotationValueRowSchema>;

/**
 * POST /api/annotations/values — write values into an annotation column.
 * Exactly one source:
 *   - `rows`               explicit row-index list (per-cell edits)
 *   - `collectionId`       promote a saved collection (label = collection name)
 *   - `fromScatterSelection` stamp the staged `__scatter_selection` (lasso) —
 *                          the client POSTs row indices to /api/scatter-selection
 *                          first, then the server resolves obs identity by JOIN.
 *   - `predicate`          stamp `label` onto every obs matching a SQL WHERE
 *                          fragment (the node-graph Annotate node's batch door).
 */
export const WriteAnnotationValuesBodySchema = z.object({
  column: z.string().min(1).max(200).regex(COLUMN_NAME_RE, "Invalid character in column name"),
  rows: z.array(AnnotationValueRowSchema).max(2_000_000).optional(),
  collectionId: z.string().optional(),
  fromScatterSelection: z.boolean().optional(),
  /**
   * Stamp `label` onto every obs matching this SQL predicate. Trust model =
   * `/api/annotations/export`: a single-user local tool, so the client's Mosaic
   * WHERE-fragment is interpolated server-side against the `dataset` VIEW.
   */
  predicate: z.string().min(1).optional(),
  /** Label applied to a collectionId promotion (defaults to collection name) or a selection/predicate stamp. */
  label: z.string().min(1).max(200).optional(),
});
export type WriteAnnotationValuesBody = z.infer<typeof WriteAnnotationValuesBodySchema>;

/** Row scope for the annotation export: all obs, the active filter, or a collection. */
export const ExportScopeSchema = z.union([
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("filter"), predicate: z.string().min(1) }),
  z.object({ kind: z.literal("collection"), collectionId: z.string().min(1) }),
]);
export type ExportScope = z.infer<typeof ExportScopeSchema>;

const AnnotationColumnNames = z.array(z.string().min(1).max(200).regex(COLUMN_NAME_RE, "Invalid column name"));

/**
 * POST /api/annotations/export — write a wide table (obs_name + chosen annotation
 * columns) for the row scope to the server export-dir.
 */
export const AnnotationExportBodySchema = z.object({
  columns: AnnotationColumnNames.min(1),
  scope: ExportScopeSchema,
  format: z.enum(["parquet", "csv"]).default("parquet"),
  filename: z.string().max(200).optional(),
});
export type AnnotationExportBody = z.infer<typeof AnnotationExportBodySchema>;

/**
 * POST /api/annotations/commit[?dryRun=1] — write annotation columns into each
 * source AnnData `.obs` on disk. Omitting `columns` commits all of them.
 */
export const CommitAnnotationsBodySchema = z.object({
  columns: AnnotationColumnNames.optional(),
});
export type CommitAnnotationsBody = z.infer<typeof CommitAnnotationsBodySchema>;

/**
 * One dataset's entry in the commit response — a discriminated union. A success
 * item spreads the zarr `CommitReport` (`format`/`nObs`/`columns`/`written`); an
 * error/skip item (remote store, missing source, or a thrown write) carries only
 * `error` and NO `format`/`columns`. Consumers MUST discriminate on `error`
 * before reading `columns`/`format`, else remote-skip and failure rows throw.
 */
export const CommitDatasetReportSchema = z.union([
  z.object({
    datasetKey: z.string(),
    path: z.string(),
    format: z.enum(["v2", "v3"]),
    nObs: z.number(),
    columns: z.array(z.object({ name: z.string(), kind: z.string(), nNonNull: z.number() })),
    written: z.boolean(),
  }),
  z.object({
    datasetKey: z.string(),
    path: z.string().optional(),
    error: z.string(),
  }),
]);
export type CommitDatasetReport = z.infer<typeof CommitDatasetReportSchema>;

/** Response of POST /api/annotations/commit[?dryRun=1]. */
export const CommitAnnotationsResponseSchema = z.object({
  dryRun: z.boolean(),
  datasets: z.array(CommitDatasetReportSchema),
});
export type CommitAnnotationsResponse = z.infer<typeof CommitAnnotationsResponseSchema>;
