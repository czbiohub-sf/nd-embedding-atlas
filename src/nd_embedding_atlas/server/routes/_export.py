"""Export endpoints for subsetting and writing zarr stores."""

import asyncio
import re
import uuid
from collections.abc import Callable
from typing import Annotated, Any

import numpy as np
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from nd_embedding_atlas.server._state import ExportTaskState, ViewerState
from nd_embedding_atlas.vz._export import export_subset


class ExportRequest(BaseModel):
    """Request body for the export endpoint."""

    predicate: str
    filename: str = "export"
    selection_type: str = "unknown"
    embedding_key: str | None = None


def _sanitize_filename(name: str) -> str:
    """Strip path separators and replace non-alphanumeric chars (except ``_ - .``)."""
    name = name.replace("/", "").replace("\\", "").replace("\x00", "")
    name = re.sub(r"[^\w\-.]", "_", name)
    return name or "export"


def _query_indices(predicate: str, state: ViewerState) -> np.ndarray:
    # Use the main connection (not cursor()) so temp tables like __scatter_selection
    # — created on con by the scatter route — are visible. DuckDB scopes temp tables
    # per-connection; a fresh cursor() opens a new connection with its own temp schema.
    rows = state.store.con.execute(f"SELECT __row_index__ FROM dataset WHERE {predicate}").fetchall()
    return np.array([r[0] for r in rows], dtype=np.int64)


def _run_export(indices: np.ndarray, request: ExportRequest, state: ViewerState) -> dict[str, Any]:
    """Run export in thread pool. Returns result dict."""
    filename = _sanitize_filename(request.filename)
    state.export_dir.mkdir(parents=True, exist_ok=True)
    output_path = state.export_dir / f"{filename}.zarr"

    export_subset(
        state.collection,
        indices,
        output_path,
        selection_type=request.selection_type,
        embedding_key=request.embedding_key,
    )
    return {"output_path": str(output_path), "n_obs": len(indices)}


async def _export_bg(indices: np.ndarray, request: ExportRequest, state: ViewerState) -> None:
    """Background coroutine for export."""
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(state.executor, _run_export, indices, request, state)
        state.export_task.status = "done"
        state.export_task.output_path = result["output_path"]
        state.export_task.n_obs = result["n_obs"]
    except Exception as e:  # noqa: BLE001
        state.export_task.status = "error"
        state.export_task.error = str(e)


def make_export_router(get_state: Callable[[], ViewerState]) -> APIRouter:
    """Return an APIRouter for export endpoints."""
    router = APIRouter()
    State = Annotated[ViewerState, Depends(get_state)]

    @router.post("/api/export")
    async def start_export(request: ExportRequest, state: State) -> JSONResponse:
        # MuData sources don't expose a DatasetCollection — export is unsupported
        if state.collection is None:
            return JSONResponse({"error": "Export not supported for MuData stores"}, status_code=501)

        # Check for concurrent export
        if state.export_task is not None and not state.export_task.task.done():
            return JSONResponse({"error": "An export is already in progress"}, status_code=409)

        # Validate predicate by querying for indices
        loop = asyncio.get_running_loop()
        try:
            indices = await loop.run_in_executor(state.executor, _query_indices, request.predicate, state)
        except Exception as e:  # noqa: BLE001
            return JSONResponse({"error": f"Invalid predicate: {e}"}, status_code=400)

        if len(indices) == 0:
            return JSONResponse({"error": "No observations match the predicate"}, status_code=400)

        if int(np.max(indices)) >= state.store.n_obs:
            return JSONResponse(
                {"error": f"Row index out of bounds: max={int(np.max(indices))}, n_obs={state.store.n_obs}"},
                status_code=400,
            )

        # Start background export
        task_id = uuid.uuid4().hex[:12]
        bg = asyncio.create_task(_export_bg(indices, request, state))
        state.export_task = ExportTaskState(task_id=task_id, task=bg)

        return JSONResponse({"task_id": task_id, "status": "running"}, status_code=202)

    @router.get("/api/export/{task_id}/status")
    async def export_status(task_id: str, state: State) -> JSONResponse:
        if state.export_task is None or state.export_task.task_id != task_id:
            return JSONResponse({"error": "Export task not found"}, status_code=404)

        if state.export_task.status == "running":
            return JSONResponse({"status": "running"})
        if state.export_task.status == "error":
            return JSONResponse({"status": "error", "error": state.export_task.error or "Unknown error"})
        if state.export_task.status == "done":
            return JSONResponse(
                {
                    "status": "done",
                    "output_path": state.export_task.output_path,
                    "n_obs": state.export_task.n_obs,
                }
            )
        return JSONResponse({"status": state.export_task.status})

    return router
