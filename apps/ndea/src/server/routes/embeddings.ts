/**
 * Embedding loading and status endpoints.
 *
 * POST /api/embeddings/{key}      : Trigger async embedding load
 * GET  /api/embeddings/{key}/status: Poll load status
 */

import { ObsmSliceLoader } from "../slice-loader.ts";
import type { ServerSession } from "../state.ts";

interface EmbeddingStatusEvent {
  status: "loading" | "ready" | "error" | "not_started";
  error?: string;
  nDims?: number;
}

function currentEmbeddingStatus(key: string, state: ServerSession): EmbeddingStatusEvent {
  const loader = state.obsmLoaders.get(key);
  if (loader) return { status: "ready", nDims: loader.width };
  const err = state.loadErrors.get(key);
  if (err) return { status: "error", error: err };
  if (state.loadingTasks.has(key)) return { status: "loading" };
  return { status: "not_started" };
}

/**
 * Handle POST /api/embeddings/{key}
 *
 * Phase 0: "loading" is now a metadata-only probe: we detect the
 * embedding's width (nDims) via a zarr shape read, then register a
 * lazy `ObsmSliceLoader` in `state.obsmLoaders`. Actual column data is
 * fetched on demand by `/api/scatter-positions`.
 *
 * The old DuckDB ingest path (full-matrix load + INSERT VALUES) is
 * skipped because no SQL consumer reads embedding columns today.
 */
export function handleLoadEmbedding(key: string, state: ServerSession): Response {
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

  return Response.json({ status: "loading" }, { status: 202 });
}

/**
 * "Load" an obsm embedding: detect its width via metadata, register a
 * column-wise loader. No data bytes are read at this step.
 *
 * Idempotent: a second call for an already-registered key is a no-op.
 * Safe to call from both the startup pre-warm path (silent, all keys
 * await'd in parallel) and the lazy `POST /api/embeddings/{key}` path.
 *
 * Doesn't log on success: startup prints the consolidated "Embeddings:"
 * line, so per-key console output would just be noise.
 */
export async function loadEmbeddingAsync(key: string, state: ServerSession): Promise<void> {
  if (state.obsmLoaders.has(key)) return;
  try {
    const accessors = [...state.accessors.entries()];
    const width = await ObsmSliceLoader.detectWidth(key, accessors);
    const loader = new ObsmSliceLoader(key, accessors, width);
    state.obsmLoaders.set(key, loader);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.loadErrors.set(key, msg);
    console.error(`    ✗ Failed to register ${key}: ${msg}`);
  }
}

/**
 * Handle GET /api/embeddings/{key}/status
 *
 * Returns the current load status for an embedding.
 */
export function handleEmbeddingStatus(key: string, state: ServerSession): Response {
  const ev = currentEmbeddingStatus(key, state);
  if (ev.status === "ready") return Response.json({ status: "ready", n_dims: ev.nDims });
  if (ev.status === "error") return Response.json({ status: "error", error: ev.error }, { status: 500 });
  return Response.json({ status: ev.status });
}
