/**
 * Config endpoint — GET /api/config
 *
 * Returns viewer configuration (datasets, spatial columns, obs columns, embeddings).
 * The frontend may read all config from /data/metadata.json instead;
 * this endpoint exists for backward compatibility.
 */

import { ConfigResponseSchema, type ConfigResponse } from "../protocol.ts";
import type { ViewerState } from "../state.ts";

/**
 * Handle GET /api/config
 */
export function handleConfig(state: ViewerState): Response {
  const datasets: ConfigResponse["datasets"] = {};
  for (const [key, cfg] of state.datasets) {
    datasets[key] = {
      path: cfg.path,
      platePath: cfg.platePath ?? null,
    };
  }

  const result = {
    datasets,
    spatial: state.spatial,
    obsColumns: state.obsColumns,
    availableObsmKeys: state.availableObsmKeys,
    loadedEmbeddings: Array.from(state.obsmLoaders.keys()),
    nObs: state.store.nObs,
    port: state.port,
  } satisfies ConfigResponse;
  ConfigResponseSchema.parse(result);
  return Response.json(result);
}
