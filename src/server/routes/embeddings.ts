/**
 * Embedding loading and status endpoints.
 *
 * POST /api/embeddings/{key}       — Trigger async embedding load
 * GET  /api/embeddings/{key}/status — Poll load status
 */

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
  if (state.store.loadedEmbeddings.has(key)) {
    const meta = state.store.loadedEmbeddings.get(key)!;
    return { status: "ready", nDims: meta.nDims };
  }
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
 * Triggers async loading of an obsm embedding into DuckDB.
 * Reads the embedding from zarr via axial's AnnDataAccessor.getObsm(),
 * then registers it in the EmbeddingStore (adds columns to DuckDB VIEW).
 */
export function handleLoadEmbedding(key: string, state: ViewerState): Response {
  // Check if the key is known
  if (!state.availableObsmKeys.includes(key)) {
    return Response.json({ error: `Unknown obsm key: ${key}` }, { status: 404 });
  }

  // Already loaded
  if (state.store.loadedEmbeddings.has(key)) {
    return Response.json({ status: "ready" });
  }

  // Already loading
  if (state.loadingTasks.has(key) && !state.loadErrors.has(key)) {
    return Response.json({ status: "loading" }, { status: 202 });
  }

  // Clear previous error if retrying
  state.loadErrors.delete(key);

  // Start async loading task
  const loadPromise = loadEmbeddingAsync(key, state);
  state.loadingTasks.set(key, loadPromise);
  fireEmbeddingStatus(key, state);

  return Response.json({ status: "loading" }, { status: 202 });
}

/**
 * Load an obsm embedding from zarr and register it in DuckDB.
 *
 * For multi-dataset: loads from each dataset's accessor, concatenates
 * the coords in dataset order (matching obs_base row order).
 */
async function loadEmbeddingAsync(key: string, state: ViewerState): Promise<void> {
  try {
    const accessors = [...state.accessors.entries()];

    // Load obsm from each dataset and concatenate
    const chunks: Float32Array[] = [];
    let nDims = 0;

    for (const [dsName, accessor] of accessors) {
      try {
        const result = await accessor.getObsm(key);
        const data = result.data as Float32Array;
        nDims = result.shape[1];
        chunks.push(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load ${key} from dataset "${dsName}": ${msg}`, { cause: err });
      }
    }

    // Concatenate all chunks into one flat array
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const coords = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      coords.set(chunk, offset);
      offset += chunk.length;
    }

    // Register in DuckDB (adds columns to the VIEW)
    await state.store.registerEmbedding(key, coords, nDims);

    console.log(`    ✓ Loaded ${key} (${nDims}D, ${coords.length / nDims} points)`);
    fireEmbeddingStatus(key, state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.loadErrors.set(key, msg);
    console.error(`    ✗ Failed to load ${key}: ${msg}`);
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
