/**
 * Metadata endpoint — GET /data/metadata.json
 *
 * Returns table schema, column info, embedding status, and spatial metadata.
 * The frontend loads this once on startup via TanStack Query.
 */

import type { ViewerState, DatasetMeta } from "../state.ts";
import type { EmbeddingStore } from "../store.ts";
import { obsmColumnPrefix } from "../store.ts";
import { exportDir } from "./export.ts";

/** Return var count of the first accessor (or 0 if none registered). */
function firstVarCount(state: ViewerState): number {
  const iter = state.accessors.values().next();
  return iter.done ? 0 : iter.value.nVars;
}

/** Build obsm metadata including loaded status. */
function buildObsmMetadata(
  availableKeys: string[],
  store: EmbeddingStore,
): Record<string, { prefix: string; n_dims: number | null; loaded: boolean }> {
  const meta: Record<string, { prefix: string; n_dims: number | null; loaded: boolean }> = {};
  for (const key of availableKeys) {
    const prefix = obsmColumnPrefix(key);
    const loaded = store.loadedEmbeddings.get(key);
    if (loaded) {
      meta[key] = { prefix, n_dims: loaded.nDims, loaded: true };
    } else {
      meta[key] = { prefix, n_dims: null, loaded: false };
    }
  }
  return meta;
}

/**
 * Handle GET /data/metadata.json
 *
 * Returns the full dataset metadata used to initialize the dashboard.
 */
export function handleMetadata(state: ViewerState, config: DatasetMeta): Response {
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
    obsm: buildObsmMetadata(state.availableObsmKeys, state.store),
    obs_columns: config.obsColumnNames,
    plate: config.hasPlate,
    export_dir: exportDir(),
    var_count: firstVarCount(state),
    layers: ["X"],
    spatial: state.spatial
      ? {
          fov_col: state.spatial.fov,
          t_col: state.spatial.t,
          bbox_col: state.spatial.bbox,
          x_col: state.spatial.x,
          y_col: state.spatial.y,
        }
      : { fov_col: null, t_col: null, bbox_col: null, x_col: null, y_col: null },
  };

  if (config.plateMeta) {
    Object.assign(result, config.plateMeta);
  }
  if (config.datasetKeys) {
    result.dataset_keys = config.datasetKeys;
  }
  if (config.datasetChannels) {
    result.dataset_channels = config.datasetChannels;
  }

  return Response.json(result);
}
