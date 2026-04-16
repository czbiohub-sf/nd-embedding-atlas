/**
 * Bun.serve HTTP server factory.
 * Replaces Python FastAPI create_app().
 */

export { EmbeddingStore, obsmColumnPrefix, DEFAULT_OBSM_PRIORITY } from "./store.ts";
export { handleMosaicQuery, parseMosaicQuery, isAllowedSql, ARROW_IPC_CONTENT_TYPE } from "./mosaic.ts";
export { detectSpatialColumns, parseBbox, prepareObs } from "./prepare.ts";
export type {
    SpatialColumns,
    ChannelConfig,
    DatasetConfig,
    DatasetMeta,
    ViewerState,
} from "./state.ts";
export type { MosaicQuery } from "./mosaic.ts";
export type { EmbeddingMeta } from "./store.ts";
export type { BboxRect, PrepareResult } from "./prepare.ts";

export function createApp() {
    // Phase 2: wire up routes, DuckDB store, static serving
}
