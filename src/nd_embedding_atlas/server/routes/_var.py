"""Var (gene) name search, layer listing, and gene-expression column materialization endpoints."""

import asyncio
import re
import uuid
from collections.abc import Callable
from typing import Annotated

import numpy as np
import pyarrow as pa
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from nd_embedding_atlas.server._state import GeneTaskState, ViewerState


def _sanitize_column_name(var_name: str, layer: str) -> str:
    """Return the DuckDB column name for a var+layer combination."""
    safe_var = re.sub(r"[^a-zA-Z0-9]", "_", var_name)
    safe_layer = re.sub(r"[^a-zA-Z0-9]", "_", layer)
    return f"__var_{safe_var}_{safe_layer}__"


def _column_exists(state: ViewerState, col_name: str) -> bool:
    """Return True if col_name is already a column in obs_base."""
    with state.store.cursor() as cur:
        rows = cur.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'obs_base' AND column_name = ?",
            [col_name],
        ).fetchall()
    return len(rows) > 0


def _materialize_gene_sync(state: ViewerState, gene: str, layer: str, col_name: str) -> None:
    import scipy.sparse as sp  # optional dep — only imported when needed

    adata = state.collection._concat
    if gene not in adata.var_names:
        msg = f"Var '{gene}' not found in var_names"
        raise ValueError(msg)

    # Slice a single var column — efficient for sparse matrices
    expr = adata[:, gene].layers[layer] if layer != "X" else adata[:, gene].X

    # Handle dask (lazy), sparse, or dense
    if hasattr(expr, "compute"):
        expr = expr.compute()
    if sp.issparse(expr):
        expr = expr.toarray()
    col_data = np.asarray(expr).ravel().astype(np.float32)

    arr = pa.array(col_data, type=pa.float32())
    state.store.add_obs_column(col_name, arr)


async def _materialize_gene_bg(
    state: ViewerState,
    gene: str,
    layer: str,
    col_name: str,
    task_id: str,
) -> None:
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(
            state.store.executor,
            lambda: _materialize_gene_sync(state, gene, layer, col_name),
        )
        state.gene_tasks[task_id].status = "ready"
    except Exception as exc:
        state.gene_tasks[task_id].status = "error"
        state.gene_tasks[task_id].error = str(exc)
        raise


class _GeneColumnRequest(BaseModel):
    gene: str
    layer: str = "X"


def make_var_router(get_state: Callable[[], ViewerState]) -> APIRouter:
    """Return an APIRouter for var-name, layer, and gene-column endpoints."""
    router = APIRouter()
    State = Annotated[ViewerState, Depends(get_state)]

    @router.get("/api/var/names")
    async def get_var_names(state: State, q: str = "", limit: int = 50) -> dict:
        all_names: list[str] = sorted(state.collection.var_names.tolist())
        if q:
            q_lower = q.lower()
            matches = [n for n in all_names if q_lower in n.lower()]
        else:
            matches = all_names
        return {"names": matches[:limit]}

    @router.get("/api/var/layers")
    async def get_var_layers(state: State) -> dict:
        try:
            layer_keys = list(state.collection._concat.layers.keys())
        except Exception:  # noqa: BLE001
            layer_keys = []
        return {"layers": ["X", *layer_keys]}

    @router.post("/api/gene-column")
    async def post_gene_column(body: _GeneColumnRequest, state: State) -> JSONResponse:
        gene = body.gene
        layer = body.layer
        col_name = _sanitize_column_name(gene, layer)

        # Already materialized — return immediately
        if _column_exists(state, col_name):
            return JSONResponse({"status": "ready", "column": col_name}, status_code=200)

        # Check for an in-flight task for the same column
        for existing in state.gene_tasks.values():
            if existing.column == col_name and existing.status == "loading":
                return JSONResponse(
                    {"error": f"Gene column '{col_name}' is already being materialized"},
                    status_code=409,
                )

        task_id = str(uuid.uuid4())
        gene_task = GeneTaskState(task_id=task_id, task=None, status="loading", column=col_name)  # type: ignore[arg-type]
        state.gene_tasks[task_id] = gene_task

        task = asyncio.create_task(_materialize_gene_bg(state, gene, layer, col_name, task_id))
        state.gene_tasks[task_id].task = task

        return JSONResponse({"task_id": task_id, "status": "loading", "column": col_name}, status_code=202)

    @router.get("/api/gene-column/{task_id}/status")
    async def get_gene_column_status(task_id: str, state: State) -> JSONResponse:
        if task_id not in state.gene_tasks:
            return JSONResponse({"error": "Unknown task_id"}, status_code=404)

        gene_task = state.gene_tasks[task_id]
        if gene_task.status == "loading":
            return JSONResponse({"status": "loading", "column": gene_task.column})
        if gene_task.status == "ready":
            return JSONResponse({"status": "ready", "column": gene_task.column})
        # error
        return JSONResponse(
            {"status": "error", "column": gene_task.column, "error": gene_task.error},
            status_code=500,
        )

    return router
