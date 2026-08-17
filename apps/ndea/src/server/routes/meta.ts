/**
 * Metadata endpoint: GET /data/metadata.json
 *
 * Returns table schema, column info, embedding status, and spatial metadata.
 * The frontend loads this once on startup via TanStack Query.
 */

import { deriveDataCapabilities } from "../capabilities.ts";
import { MetadataSchema, type ObsmEntry } from "../protocol.ts";
import { cropFovColumn, type ServerSession, type DatasetSessionMetadata } from "../state.ts";
import { obsmColumnPrefix } from "../store.ts";
import { exportDir } from "../export-util.ts";

/** Return var count of the first accessor (or 0 if none registered). */
function firstVarCount(state: ServerSession): number {
  const iter = state.accessors.values().next();
  if (iter.done) return 0;
  // For AnnData: var.length is the modality's nVars.
  // For MuData: root var.length + sum of per-modality var lengths (axis=0).
  const handle = iter.value;
  if (handle.kind === "mudata") {
    // Narrowing via kind: MuData type lives in mudata.ts. To avoid a
    // cross-import cycle here, inspect the shape duck-typed.
    const mu = handle as unknown as { var: { length: number }; mod: ReadonlyMap<string, { var: { length: number } }> };
    let total = mu.var.length;
    for (const m of mu.mod.values()) total += m.var.length;
    return total;
  }
  return handle.var.length;
}

/** Build obsm metadata including loaded status + modality tag for MuData keys. */
function buildObsmMetadata(availableKeys: string[], state: ServerSession): Record<string, ObsmEntry> {
  const meta: Record<string, ObsmEntry> = {};
  for (const key of availableKeys) {
    const prefix = obsmColumnPrefix(key);
    const loader = state.obsmLoaders.get(key);
    const entry: ObsmEntry = loader
      ? { prefix, n_dims: loader.width, loaded: true }
      : { prefix, n_dims: null, loaded: false };
    // Tag modality for MuData keys formatted "<mod>:<obsm_key>"
    const colon = key.indexOf(":");
    if (colon > 0) entry.modality = key.slice(0, colon);
    meta[key] = entry;
  }
  return meta;
}

/**
 * Handle GET /data/metadata.json
 *
 * Returns the full dataset metadata used to initialize a dataset session.
 */
export function handleMetadata(state: ServerSession, config: DatasetSessionMetadata): Response {
  const result: Record<string, unknown> = {
    version: "0.0.0-dev",
    props: {
      data: {
        id: config.idColumn,
        projection: { x: config.defaultX, y: config.defaultY },
      },
      ...config.embeddingProps,
    },
    database: { type: "rest" },
    obsm: buildObsmMetadata(state.availableObsmKeys, state),
    // Serve only user-facing obs columns. `__`-prefixed columns are internal
    // machinery: categorical encodings (`__ev_<col>_id`, added post-startup by
    // /api/categorize), var-expression columns (`__var_N_X__`), and identity
    // (`__obs_index__` / `__row_index__`). They stay in `state.obsColumns` so
    // category_col validation still sees them; clients (table grid, obs color
    // picker) only ever want the real columns. Single-`_` names like `_dataset`
    // are kept: ExportDialog depends on `_dataset`.
    obs_columns: config.obsColumnNames.filter((c) => !c.startsWith("__")),
    plate: config.hasPlate,
    export_dir: exportDir(),
    var_count: firstVarCount(state),
    layers: ["X"],
    // Active preset name: a shipped build resolves this to a bundled graph; a
    // build launched with no --preset falls back to annotate (the default).
    preset: config.preset ?? "annotate",
    spatial: state.spatial
      ? {
          fov_col: state.spatial.fov,
          crop_fov_col: cropFovColumn(state.spatial),
          t_col: state.spatial.t,
          bbox_col: state.spatial.bbox,
          x_col: state.spatial.x,
          y_col: state.spatial.y,
          z_col: state.spatial.z,
        }
      : {
          fov_col: null,
          crop_fov_col: null,
          t_col: null,
          bbox_col: null,
          x_col: null,
          y_col: null,
          z_col: null,
        },
  };

  // MuData-specific fields (only when the first handle is a MuData)
  const firstHandle = state.accessors.values().next().value;
  if (firstHandle?.kind === "mudata") {
    const mu = firstHandle as unknown as {
      mod: ReadonlyMap<string, { var: { length: number }; obs: { columns: readonly string[] } }>;
    };
    const modalities = [...mu.mod.keys()];
    result.modalities = modalities;

    const varCount: Record<string, number> = {};
    const modalityObsColumns: Record<string, string[]> = {};
    for (const [modName, modAdata] of mu.mod) {
      varCount[modName] = modAdata.var.length;
      modalityObsColumns[modName] = [...modAdata.obs.columns];
    }
    result.var_count = varCount;
    result.modality_obs_columns = modalityObsColumns;
  }

  if (config.plateMeta) {
    Object.assign(result, config.plateMeta);
  }
  if (config.datasetKeys) {
    result.dataset_keys = config.datasetKeys;
  }
  if (config.datasetChannels) {
    result.dataset_channels = config.datasetChannels;
  }

  // Provided data-capability set (CAPABILITY-CONTRACT.md §3): derived from the
  // metadata facts assembled above; the wire single-source-of-truth the
  // frontend reads through `capabilitiesOf()`.
  const spatialMeta = result.spatial as { x_col?: string | null } | undefined;
  const modalities = result.modalities as string[] | undefined;
  result.capabilities = deriveDataCapabilities({
    hasObs: (config.obsColumnNames?.length ?? 0) > 0,
    varCount: result.var_count as number | Record<string, number> | undefined,
    obsmKeys: Object.keys(result.obsm as Record<string, unknown>),
    hasSpatialXY: spatialMeta?.x_col != null,
    hasPlate: config.hasPlate,
    isMultimodal: Array.isArray(modalities) && modalities.length > 0,
  });

  MetadataSchema.parse(result);
  return Response.json(result);
}
