"""Var name search, layer listing, and var-expression column materialization endpoints."""

import asyncio
import json
import re
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Annotated

import numpy as np
import pyarrow as pa
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse, ServerSentEvent

from nd_embedding_atlas.server._state import VarTaskState, ViewerState


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


def _materialize_var_sync(
    state: ViewerState, var_name: str, layer: str, col_name: str, modality: str | None = None
) -> dict:
    """Materialize a var expression column into DuckDB. Returns ``{"vmin": ..., "vmax": ...}``."""
    import scipy.sparse as sp  # optional dep — only imported when needed

    from nd_embedding_atlas.io._mudata import MuDataSource

    if isinstance(state.source, MuDataSource):
        import anndata as ad

        from nd_embedding_atlas.io._store import store_ctx

        mod = modality or state.source.modalities[0]
        with store_ctx(state.source.path) as s:
            x_data = ad.io.read_elem(s[f"mod/{mod}/X"])
            var_df = ad.io.read_elem(s[f"mod/{mod}/var"])

        if var_name not in var_df.index:
            msg = f"Var '{var_name}' not found in modality '{mod}'"
            raise ValueError(msg)

        var_idx = list(var_df.index).index(var_name)
        expr = x_data[:, var_idx]
        if hasattr(expr, "compute"):
            expr = expr.compute()
        if sp.issparse(expr):
            expr = expr.toarray()
        col_data = np.asarray(expr).ravel().astype(np.float32)
    else:
        if state.collection is None:
            msg = "No data source available for var column materialization"
            raise NotImplementedError(msg)

        adata = state.collection._concat
        if var_name not in adata.var_names:
            msg = f"Var '{var_name}' not found in var_names"
            raise ValueError(msg)

        # Slice a single var column — efficient for sparse matrices
        expr = adata[:, var_name].layers[layer] if layer != "X" else adata[:, var_name].X

        # Handle dask (lazy), sparse, or dense
        if hasattr(expr, "compute"):
            expr = expr.compute()
        if sp.issparse(expr):
            expr = expr.toarray()
        col_data = np.asarray(expr).ravel().astype(np.float32)

    # Compute range for colormap clims
    finite = col_data[np.isfinite(col_data)]
    vmin = float(finite.min()) if len(finite) else 0.0
    vmax = float(finite.max()) if len(finite) else 1.0

    arr = pa.array(col_data, type=pa.float32())
    state.store.add_obs_column(col_name, arr)
    return {"vmin": vmin, "vmax": vmax}


async def _materialize_var_bg(
    state: ViewerState,
    var_name: str,
    layer: str,
    col_name: str,
    task_id: str,
    modality: str | None = None,
) -> None:
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(
            state.store.executor,
            lambda: _materialize_var_sync(state, var_name, layer, col_name, modality=modality),
        )
        task = state.var_tasks[task_id]
        task.status = "ready"
        task.vmin = result["vmin"]
        task.vmax = result["vmax"]
    except Exception as exc:  # noqa: BLE001
        state.var_tasks[task_id].status = "error"
        state.var_tasks[task_id].error = str(exc)


class _VarColumnRequest(BaseModel):
    gene: str  # var name — kept as "gene" for frontend JSON compat
    layer: str = "X"
    modality: str | None = None


def make_var_router(get_state: Callable[[], ViewerState]) -> APIRouter:
    """Return an APIRouter for var-name, layer, and var-column endpoints."""
    router = APIRouter()
    State = Annotated[ViewerState, Depends(get_state)]

    @router.get("/api/var/names")
    async def get_var_names(state: State, q: str = "", limit: int = 50, modality: str | None = None) -> dict:
        from nd_embedding_atlas.io._mudata import MuDataSource, get_var_names_mudata

        if isinstance(state.source, MuDataSource):
            if modality is None:
                modality = state.source.modalities[0]
            all_names = get_var_names_mudata(state.source.path, modality)
        elif state.collection is not None:
            all_names = sorted(state.collection.var_names.tolist())
        else:
            return {"names": [], "modality": modality}

        if q:
            q_lower = q.lower()
            matches = [n for n in all_names if q_lower in n.lower()]
        else:
            matches = all_names
        return {"names": matches[:limit], "modality": modality}

    @router.get("/api/var/layers")
    async def get_var_layers(state: State) -> dict:
        if state.collection is None:
            return {"layers": ["X"]}
        try:
            layer_keys = list(state.collection._concat.layers.keys())
        except Exception:  # noqa: BLE001
            layer_keys = []
        return {"layers": ["X", *layer_keys]}

    @router.post("/api/var-column")
    async def post_var_column(body: _VarColumnRequest, state: State) -> JSONResponse:
        var_name = body.gene
        layer = body.layer
        col_name = _sanitize_column_name(var_name, layer)

        # Already materialized — query min/max from DuckDB and return
        if _column_exists(state, col_name):
            with state.store.cursor() as cur:
                row = cur.execute(f'SELECT MIN("{col_name}"), MAX("{col_name}") FROM obs_base').fetchone()
            vmin = float(row[0]) if row and row[0] is not None else 0.0
            vmax = float(row[1]) if row and row[1] is not None else 1.0
            return JSONResponse({"status": "ready", "column": col_name, "vmin": vmin, "vmax": vmax}, status_code=200)

        # Check for an in-flight task for the same column
        for existing in state.var_tasks.values():
            if existing.column == col_name and existing.status == "loading":
                return JSONResponse(
                    {"error": f"Var column '{col_name}' is already being materialized"},
                    status_code=409,
                )

        task_id = str(uuid.uuid4())
        var_task = VarTaskState(task_id=task_id, task=None, status="loading", column=col_name)  # type: ignore[arg-type]
        state.var_tasks[task_id] = var_task

        task = asyncio.create_task(_materialize_var_bg(state, var_name, layer, col_name, task_id, modality=body.modality))
        state.var_tasks[task_id].task = task

        return JSONResponse({"task_id": task_id, "status": "loading", "column": col_name}, status_code=202)

    @router.get("/api/var-column/{task_id}/status")
    async def get_var_column_status(task_id: str, state: State) -> JSONResponse:
        if task_id not in state.var_tasks:
            return JSONResponse({"error": "Unknown task_id"}, status_code=404)

        var_task = state.var_tasks[task_id]
        if var_task.status == "loading":
            return JSONResponse({"status": "loading", "column": var_task.column})
        if var_task.status == "ready":
            resp: dict = {"status": "ready", "column": var_task.column}
            if var_task.vmin is not None:
                resp["vmin"] = var_task.vmin
                resp["vmax"] = var_task.vmax
            return JSONResponse(resp)
        # error
        return JSONResponse(
            {"status": "error", "column": var_task.column, "error": var_task.error},
            status_code=500,
        )

    @router.get("/api/var-column/{task_id}/stream")
    async def var_column_stream(task_id: str, state: State) -> EventSourceResponse:
        """SSE stream that pushes var-column materialization status until terminal."""

        async def _generate() -> AsyncIterator[ServerSentEvent]:
            if task_id not in state.var_tasks:
                yield ServerSentEvent(
                    data=json.dumps({"status": "error", "error": "Unknown task_id"}),
                    event="status",
                )
                return

            var_task = state.var_tasks[task_id]

            # Already terminal
            if var_task.status == "ready":
                resp: dict = {"status": "ready", "column": var_task.column}
                if var_task.vmin is not None:
                    resp["vmin"] = var_task.vmin
                    resp["vmax"] = var_task.vmax
                yield ServerSentEvent(data=json.dumps(resp), event="status")
                return

            if var_task.status == "error":
                yield ServerSentEvent(
                    data=json.dumps({"status": "error", "column": var_task.column, "error": var_task.error}),
                    event="status",
                )
                return

            # Loading — emit initial status and poll
            yield ServerSentEvent(data=json.dumps({"status": "loading"}), event="status")

            while not var_task.task.done():
                await asyncio.wait({var_task.task}, timeout=0.3)

            # Terminal
            if var_task.status == "ready":
                resp = {"status": "ready", "column": var_task.column}
                if var_task.vmin is not None:
                    resp["vmin"] = var_task.vmin
                    resp["vmax"] = var_task.vmax
                yield ServerSentEvent(data=json.dumps(resp), event="status")
            else:
                yield ServerSentEvent(
                    data=json.dumps({"status": "error", "column": var_task.column, "error": var_task.error}),
                    event="status",
                )

        return EventSourceResponse(_generate())

    return router
