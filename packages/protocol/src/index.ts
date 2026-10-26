/**
 * Wire-format schemas and types shared across ndea workspaces.
 *
 * Single source of truth for anything that crosses the HTTP boundary:
 *   - POST body schemas (server validates with .safeParse; frontend types via z.infer)
 *   - Response schemas (frontend parses; backend returns z.infer-shaped objects)
 *   - Binary-blob header schemas (scatter endpoints)
 *   - WebSocket method map
 *
 */

import { z } from "zod";
import type { HarnessEvent } from "./harness";
import { CollectionSummarySchema } from "./status";
import type { WorkspaceChange } from "./workspace";

export { ColumnCatalogSchema, columnType, quoteIdent } from "./columns";
export type { CatalogColumn, ColumnKind, ColumnType } from "./columns";
export {
  OBSERVATION_SET_TABLE,
  FilterClauseSchema,
  FilterRequestSchema,
  FilterResponseSchema,
  FilterRowSchema,
  ObservationSetCreateBodySchema,
  ObservationSetIdSchema,
  ObservationSetSchema,
} from "./filter";
export type {
  FilterClause,
  FilterRequest,
  FilterResponse,
  FilterRow,
  FilterValue,
  ObservationSet,
  ObservationSetCreateBody,
} from "./filter";
export {
  JsonPatchOpSchema,
  WorkspaceActorSchema,
  WorkspaceChangeSchema,
  WorkspaceConflictSchema,
  WorkspaceHistorySchema,
  WorkspacePatchAcceptedSchema,
  WorkspacePatchBodySchema,
  WorkspaceRestoreBodySchema,
  WorkspaceRevisionSchema,
  WorkspaceSnapshotSchema,
} from "./workspace";
export type {
  JsonPatchOp,
  WorkspaceActor,
  WorkspaceChange,
  WorkspaceConflict,
  WorkspaceHistory,
  WorkspacePatchAccepted,
  WorkspacePatchBody,
  WorkspaceRestoreBody,
  WorkspaceRevision,
  WorkspaceSnapshot,
} from "./workspace";
export {
  HarnessAgentSchema,
  HarnessEventSchema,
  HarnessModeBodySchema,
  HarnessModeSchema,
  HarnessStateSchema,
  ProposalAcceptedSchema,
  ProposalChangeSchema,
  ProposalDecisionBodySchema,
  ProposalRejectedSchema,
  ProposalSchema,
  ToolCallSchema,
} from "./harness";
export type {
  HarnessAgent,
  HarnessEvent,
  HarnessMode,
  HarnessModeBody,
  HarnessState,
  Proposal,
  ProposalAccepted,
  ProposalChange,
  ProposalDecisionBody,
  ProposalRejected,
  ToolCall,
} from "./harness";
export { CollectionSummarySchema, RuntimeStatusSchema } from "./status";
export type { CollectionSummary, RuntimeStatus } from "./status";

// ─── Shared primitives ──────────────────────────────────────────────────────

/** Non-negative 32-bit integer, safe to interpolate into SQL after validation. */
const NonNegativeInt = z.number().int().nonnegative();

// ─── POST body schemas ──────────────────────────────────────────────────────

/** POST /data/query: Mosaic SQL passthrough. Discriminated on `type`. */
export const MosaicQueryBodySchema = z.object({
  type: z.enum(["arrow", "json", "exec"]),
  sql: z.string().min(1),
});
export type MosaicQueryBody = z.infer<typeof MosaicQueryBodySchema>;

/** POST /api/crop/{fovPath}: image crop request. */
export const CropChannelSchema = z.object({
  /**
   * Zero-based zarr C-axis index this channel draws from. Optional for
   * backward compat: when omitted, the server falls back to the channel's
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
 * GET /api/channel-stats/{fov}: per-channel pixel statistics for autocontrast.
 * Computed once per FOV from the coarsest pyramid level, server-cached.
 * `lo`/`hi` are the saturation-percentile limits (Fiji-style); `dataMin`/`dataMax`
 * are the raw extent (napari-style min–max). The frontend derives display limits
 * from whichever method is selected: both ship in one response, so toggling the
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

/** POST /api/export: start async export. Frontend may send embedding_key: null. */
export const ExportBodySchema = z.object({
  predicate: z.string().min(1),
  filename: z.string().optional(),
  output_path: z.string().optional(),
  selection_type: z.string().optional(),
  embedding_key: z.string().nullable().optional(),
});
export type ExportBody = z.infer<typeof ExportBodySchema>;

/** POST /api/var-column: start materialization of a var (feature) column. */
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

/**
 * 400 response for a malformed request body (every route) or an invalid
 * workspace write: RFC 9457 problem details with JSON Pointer issues.
 */
export const ProblemSchema = z.object({
  type: z.literal("about:blank"),
  title: z.string(),
  status: z.literal(400),
  detail: z.string(),
  errors: z.array(z.object({ pointer: z.string(), detail: z.string() })),
});
export type Problem = z.infer<typeof ProblemSchema>;

/** GET /api/export-dir response. */
export const ExportDirectoryResponseSchema = z.object({
  default_dir: z.string(),
  writable: z.boolean(),
});
export type ExportDirectoryResponse = z.infer<typeof ExportDirectoryResponseSchema>;

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

/** Obs spatial-column response (bbox sub-shape). */
export const ObsBboxSchema = z.object({
  y_min: z.number(),
  x_min: z.number(),
  y_max: z.number(),
  x_max: z.number(),
});
export type ObsBbox = z.infer<typeof ObsBboxSchema>;

/** Observation info response: matches /api/obs/{row_index}. */
export const ObsInfoSchema = z.looseObject({
  fov_name: z.string().optional(),
  t: z.number(),
  x: z.number(),
  y: z.number(),
  bbox: ObsBboxSchema.optional(),
  store_index: z.number().optional(),
});
export type ObsInfo = z.infer<typeof ObsInfoSchema>;

/** Metadata response: matches /data/metadata.json. */
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
  crop_fov_col: z.string().nullable().optional(),
  t_col: z.string().nullable().optional(),
  bbox_col: z.string().nullable().optional(),
  x_col: z.string().nullable().optional(),
  y_col: z.string().nullable().optional(),
  z_col: z.string().nullable().optional(),
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
 *
 * Flat first (set-membership, not parameterized): `obsm:X_phate`-grained
 * discrimination is a structural-subtype extension deferred until a view needs
 * to target a specific embedding/channel. `obsp`/`temporal` are reserved here
 * but only emitted once their server-side detection (neighbor graph / tracks)
 * formalizes: see the §3.1 derivation table.
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
  /** The project's collections and the open one (`ndea view --collection`); `dataset_keys` lists its datasets. */
  collections: z.array(CollectionSummarySchema).optional(),
  collection: z.string().optional(),
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
   * throwing: the single compiled binary version-locks this in practice.
   */
  capabilities: z.array(DataCapabilitySchema).default([]),
});
export type Metadata = z.infer<typeof MetadataSchema>;

/** GET /api/trajectory response row. Serialized keys intentionally mix casing. */
export const TrajectoryFrameSchema = z.object({
  rowIndex: NonNegativeInt,
  t: z.number(),
  spatial_x: z.number(),
  spatial_y: z.number(),
  datasetKey: z.string().nullable(),
  category: z.number().optional(),
  z: z.number().optional(),
});
export type TrajectoryFrame = z.infer<typeof TrajectoryFrameSchema>;
export const TrajectoryResponseSchema = z.array(TrajectoryFrameSchema);
export type TrajectoryResponse = z.infer<typeof TrajectoryResponseSchema>;

// ─── Binary-blob header schemas (scatter endpoints) ─────────────────────────

/**
 * GET /api/scatter-positions: binary format:
 *   byte 0       version (uint8) = 1
 *   bytes 1..4   header_len (uint32 LE)
 *   bytes 5..    JSON header (this shape) + padding + Float32Array[ndim · numCells]:
 *                the x column, the y column, then the z column in 3D
 * Point `i` is the observation with `__row_index__ = i` (obs_base row order).
 */
export const PositionHeaderSchema = z.object({
  numCells: z.number().int().positive(),
  embeddingKey: z.string().min(1),
  ndim: z.union([z.literal(2), z.literal(3)]),
  positionScale: z.number().positive().default(1),
});
export type PositionHeader = z.infer<typeof PositionHeaderSchema>;

/** GET /api/scatter-categories: header preceding Uint8Array[categoryIndex]. */
export const CategoryHeaderSchema = z.object({
  categoryNames: z.array(z.string()),
});
export type CategoryHeader = z.infer<typeof CategoryHeaderSchema>;

/**
 * GET /api/scatter-continuous-values: header preceding Float32Array[values].
 *
 * Values are raw (un-normalized): the GPU normalizes with (vmin, vmax) so that
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
  "workspace/watch": {
    req: Record<string, never>;
    res: WorkspaceChange;
  };
  /** Pushes the harness state on subscribe and on every change, plus one `rejected` event per invalid harness edit. */
  "harness/watch": {
    req: Record<string, never>;
    res: HarnessEvent;
  };
  /** Pushes the collection the server serves on subscribe and after every switch (`POST /api/collection`). */
  "session/watch": {
    req: Record<string, never>;
    res: { collection: string };
  };
}

// ─── Annotation schemas ──────────────────────────────────────────────────────

/**
 * Annotation/var column names flow into SQL as quoted identifiers. Unlike
 * TRUST_SAFE_RE (render-safety), this MUST exclude characters that are
 * dangerous inside a SQL identifier: above all the double-quote, which could
 * break out of `"…"` quoting. Allow letters, digits, space, underscore, dot,
 * hyphen; require a leading letter/digit/underscore. The SQL sink also escapes
 * via quoteIdent() (defense in depth), but rejecting at the door keeps weird
 * names out of table-name derivation and downstream tooling.
 */
const COLUMN_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9 _.-]*$/;

/**
 * Annotation field data type. Both stage as TEXT in DuckDB: `label` is an
 * editable categorical (committed as a categorical `.obs` column), `text` is
 * free text (committed as a string column).
 */
export const AnnotationDtypeSchema = z.enum(["label", "text"]);
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

const AnnotationColumnName = z.string().min(1).max(200).regex(COLUMN_NAME_RE, "Invalid character in column name");

/** POST /api/annotations/columns: create a new annotation field. */
export const AnnotationColumnBodySchema = z.object({
  name: AnnotationColumnName,
  dtype: AnnotationDtypeSchema.default("label"),
});
export type AnnotationColumnBody = z.infer<typeof AnnotationColumnBodySchema>;

/**
 * PATCH /api/annotations/columns/:name: rename and/or convert a field.
 * Responds `{ column: <final name>, dtype }`.
 */
export const AnnotationColumnPatchBodySchema = z
  .object({ name: AnnotationColumnName.optional(), dtype: AnnotationDtypeSchema.optional() })
  .refine((body) => body.name !== undefined || body.dtype !== undefined, "Provide name and/or dtype");
export type AnnotationColumnPatchBody = z.infer<typeof AnnotationColumnPatchBodySchema>;

/** One cell for POST /api/annotations/values. A null value clears the cell. */
export const AnnotationValueRowSchema = z.object({
  rowIndex: NonNegativeInt,
  value: z.string().nullable(),
});
export type AnnotationValueRow = z.infer<typeof AnnotationValueRowSchema>;

/**
 * POST /api/annotations/values: write cells into an annotation field by
 * `__row_index__`. The server resolves each row's obs identity; unknown row
 * indices are ignored, so `n` in the response counts only rows written.
 */
export const WriteAnnotationValuesBodySchema = z.object({
  column: AnnotationColumnName,
  rows: z.array(AnnotationValueRowSchema).min(1).max(2_000_000),
});
export type WriteAnnotationValuesBody = z.infer<typeof WriteAnnotationValuesBodySchema>;

/** Response of POST /api/annotations/values. */
export const WriteAnnotationValuesResponseSchema = z.object({
  ok: z.literal(true),
  n: NonNegativeInt,
});
export type WriteAnnotationValuesResponse = z.infer<typeof WriteAnnotationValuesResponseSchema>;

const AnnotationColumnNames = z.array(AnnotationColumnName);

/**
 * POST /api/annotations/commit[?dryRun=1]: write annotation columns into each
 * source AnnData `.obs` on disk. Omitting `columns` commits all of them.
 */
export const CommitAnnotationsBodySchema = z.object({
  columns: AnnotationColumnNames.optional(),
});
export type CommitAnnotationsBody = z.infer<typeof CommitAnnotationsBodySchema>;

/**
 * One dataset's entry in the commit response: a discriminated union. A success
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
