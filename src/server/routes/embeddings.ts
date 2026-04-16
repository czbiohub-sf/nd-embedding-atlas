/**
 * Embedding loading and status endpoints.
 *
 * POST /api/embeddings/{key}       — Trigger async embedding load
 * GET  /api/embeddings/{key}/status — Poll load status
 */

import type { ViewerState } from "../state.ts";

/**
 * Handle POST /api/embeddings/{key}
 *
 * Triggers async loading of an obsm embedding into DuckDB.
 * The actual materialization is a TODO — requires axial I/O integration
 * to read obsm from zarr stores. For now, returns appropriate status
 * based on what's already loaded.
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

    // Check if already loading
    if (state.loadingTasks.has(key)) {
        return Response.json({ status: "loading" }, { status: 202 });
    }

    // TODO: Start async loading task via axial I/O
    // For now, record the task as a placeholder promise that never resolves
    // until the actual I/O integration is wired up.
    const loadPromise = new Promise<void>((_resolve, _reject) => {
        // Phase 3: wire up axial zarr I/O to materialize obsm[key]
        // and call state.store.registerEmbedding(key, coords, nDims)
    });
    state.loadingTasks.set(key, loadPromise);

    return Response.json({ status: "loading" }, { status: 202 });
}

/**
 * Handle GET /api/embeddings/{key}/status
 *
 * Returns the current load status for an embedding.
 */
export function handleEmbeddingStatus(key: string, state: ViewerState): Response {
    // Already loaded in DuckDB
    if (state.store.loadedEmbeddings.has(key)) {
        return Response.json({ status: "ready" });
    }

    // Check for in-flight loading task
    if (state.loadingTasks.has(key)) {
        // Check if the task errored
        const errorMsg = state.loadErrors.get(key);
        if (errorMsg) {
            return Response.json({ status: "error", error: errorMsg }, { status: 500 });
        }
        return Response.json({ status: "loading" });
    }

    return Response.json({ status: "not_started" });
}
