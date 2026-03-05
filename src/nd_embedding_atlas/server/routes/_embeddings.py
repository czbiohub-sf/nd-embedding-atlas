"""Embedding loading and status endpoints."""

import asyncio
from collections.abc import Callable
from typing import TYPE_CHECKING, Annotated

import numpy as np
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from nd_embedding_atlas.server._state import ViewerState

if TYPE_CHECKING:
    from nd_embedding_atlas.io import AnnDataCollection


def _materialize_embedding(key: str, collection: "AnnDataCollection") -> np.ndarray:
    """Materialize an obsm key to float32 numpy array (runs in thread pool)."""
    coords = collection.obsm[key]
    if hasattr(coords, "persist"):
        coords = coords.persist()
    if hasattr(coords, "compute"):
        coords = coords.compute()
    return np.asarray(coords, dtype=np.float32)


async def _load_embedding_bg(key: str, state: ViewerState) -> None:
    """Background coroutine to materialize and register an embedding."""
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(state.executor, _materialize_embedding, key, state.collection)
        state.store.register_embedding(key, result)
        state.invalidate_parquet_cache()
    except Exception as e:
        state.load_errors[key] = str(e)
        raise


def make_embeddings_router(get_state: Callable[[], ViewerState]) -> APIRouter:
    """Return an APIRouter for embedding load/status endpoints."""
    router = APIRouter()
    State = Annotated[ViewerState, Depends(get_state)]

    @router.post("/api/embeddings/{key}")
    async def load_embedding(key: str, state: State) -> JSONResponse:
        if key not in state.available_obsm_keys:
            return JSONResponse({"error": f"Unknown obsm key: {key}"}, status_code=404)
        if key in state.store.loaded_embeddings:
            return JSONResponse({"status": "ready"})
        if key in state.loading_tasks and not state.loading_tasks[key].done():
            return JSONResponse({"status": "loading"}, status_code=202)

        task = asyncio.create_task(_load_embedding_bg(key, state))
        state.loading_tasks[key] = task
        return JSONResponse({"status": "loading"}, status_code=202)

    @router.get("/api/embeddings/{key}/status")
    async def embedding_status(key: str, state: State) -> JSONResponse:
        if key in state.store.loaded_embeddings:
            return JSONResponse({"status": "ready"})
        if key in state.loading_tasks:
            task = state.loading_tasks[key]
            if not task.done():
                return JSONResponse({"status": "loading"})
            if task.cancelled() or key in state.load_errors:
                error_msg = state.load_errors.get(key, "Task cancelled")
                return JSONResponse({"status": "error", "error": error_msg}, status_code=500)
            return JSONResponse({"status": "ready"})
        return JSONResponse({"status": "not_started"})

    return router
