/**
 * Embedding loading and status endpoints.
 *
 * POST /api/embeddings/{key}       — Trigger async embedding load
 * GET  /api/embeddings/{key}/status — Poll load status
 */

import { ObsmSliceLoader } from "../slice-loader.ts";
import type { ViewerState } from "../state.ts";

/** Status event emitted to embedding-status subscribers. */
export interface EmbeddingStatusEvent {
  status: "loading" | "ready" | "error" | "not_started";
  error?: string;
  nDims?: number;
}

/** Per-key subscriber set for server-pushed status transitions. */
const embeddingSubscribers = new Map<string, Set<(ev: EmbeddingStatusEvent) => void>>();

/** Compute the current status for an embedding key. */
export function currentEmbeddingStatus(key: string, state: ViewerState): EmbeddingStatusEvent {
  const loader = state.obsmLoaders.get(key);
  if (loader) return { status: "ready", nDims: loader.width };
  const err = state.loadErrors.get(key);
  if (err) return { status: "error", error: err };
  if (state.loadingTasks.has(key)) return { status: "loading" };
  return { status: "not_started" };
}

/** Fan out the current status to all subscribers of `key`. */
function fireEmbeddingStatus(key: string, state: ViewerState): void {
  const subs = embeddingSubscribers.get(key);
  if (!subs || subs.size === 0) return;
  const ev = currentEmbeddingStatus(key, state);
  for (const cb of subs) cb(ev);
}

/**
 * Subscribe to status transitions for `key`. Emits the current status
 * synchronously, then on every mutation until the returned disposer runs.
 */
export function subscribeEmbeddingStatus(
  key: string,
  state: ViewerState,
  cb: (ev: EmbeddingStatusEvent) => void,
): () => void {
  cb(currentEmbeddingStatus(key, state));
  let set = embeddingSubscribers.get(key);
  if (!set) {
    set = new Set();
    embeddingSubscribers.set(key, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) embeddingSubscribers.delete(key);
  };
}

/**
 * Handle POST /api/embeddings/{key}
 *
 * Phase 0: "loading" is now a metadata-only probe — we detect the
 * embedding's width (nDims) via a zarr shape read, then register a
 * lazy `ObsmSliceLoader` in `state.obsmLoaders`. Actual column data is
 * fetched on demand by `/api/scatter-positions`.
 *
 * The old DuckDB ingest path (full-matrix load + INSERT VALUES) is
 * skipped because no SQL consumer reads embedding columns today.
 */
export function handleLoadEmbedding(key: string, state: ViewerState): Response {
  if (!state.availableObsmKeys.includes(key)) {
    return Response.json({ error: `Unknown obsm key: ${key}` }, { status: 404 });
  }

  if (state.obsmLoaders.has(key)) {
    return Response.json({ status: "ready" });
  }

  if (state.loadingTasks.has(key) && !state.loadErrors.has(key)) {
    return Response.json({ status: "loading" }, { status: 202 });
  }

  state.loadErrors.delete(key);

  const loadPromise = loadEmbeddingAsync(key, state);
  state.loadingTasks.set(key, loadPromise);
  fireEmbeddingStatus(key, state);

  return Response.json({ status: "loading" }, { status: 202 });
}

/**
 * "Load" an obsm embedding: detect its width via metadata, register a
 * column-wise loader. No data bytes are read at this step.
 */
async function loadEmbeddingAsync(key: string, state: ViewerState): Promise<void> {
  try {
    const accessors = [...state.accessors.entries()];
    const width = await ObsmSliceLoader.detectWidth(key, accessors);
    const loader = new ObsmSliceLoader(key, accessors, width);
    state.obsmLoaders.set(key, loader);
    console.log(`    ✓ Registered ${key} (${width}D, lazy)`);
    fireEmbeddingStatus(key, state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.loadErrors.set(key, msg);
    console.error(`    ✗ Failed to register ${key}: ${msg}`);
    fireEmbeddingStatus(key, state);
  }
}

/**
 * Handle GET /api/embeddings/{key}/status
 *
 * Returns the current load status for an embedding.
 */
export function handleEmbeddingStatus(key: string, state: ViewerState): Response {
  const ev = currentEmbeddingStatus(key, state);
  if (ev.status === "ready") return Response.json({ status: "ready", n_dims: ev.nDims });
  if (ev.status === "error") return Response.json({ status: "error", error: ev.error }, { status: 500 });
  return Response.json({ status: ev.status });
}
