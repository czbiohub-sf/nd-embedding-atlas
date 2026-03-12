"""Observation lookup and health endpoints."""

import asyncio
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from nd_embedding_atlas.server._state import ViewerState
from nd_embedding_atlas.vz._prepare import parse_bbox


def _lookup_obs(row_index: int, select_cols: list[str], state: ViewerState) -> tuple | None:
    """Query DuckDB for a single observation by row index (runs in thread pool)."""
    with state.store.cursor() as cur:
        return cur.execute(
            f"SELECT {', '.join(select_cols)} FROM obs_base WHERE __row_index__ = ?",
            [row_index],
        ).fetchone()


def make_obs_router(get_state: Callable[[], ViewerState]) -> APIRouter:
    """Return an APIRouter for ``/api/obs/{row_index}`` and ``/api/health``."""
    router = APIRouter()
    State = Annotated[ViewerState, Depends(get_state)]

    @router.get("/api/obs/{row_index}", response_model=None)
    async def get_obs(row_index: int, state: State) -> dict | JSONResponse:
        """Look up spatial coordinates for an observation by row index."""
        sp = state.spatial
        select_cols = [c for c in [sp.fov, sp.t, sp.bbox, sp.x, sp.y] if c is not None]

        if not select_cols:
            return JSONResponse({"error": "No spatial columns configured"}, status_code=404)

        loop = asyncio.get_running_loop()
        row = await loop.run_in_executor(state.executor, _lookup_obs, row_index, select_cols, state)

        if row is None:
            return JSONResponse({"error": "Observation not found"}, status_code=404)

        result_map = dict(zip(select_cols, row, strict=True))
        response: dict = {}

        # fov_name (normalize from whatever source column)
        if sp.fov:
            response["fov_name"] = str(result_map[sp.fov])

        # t (default 0 when column is absent)
        response["t"] = int(result_map[sp.t]) if sp.t else 0

        # bbox parsing
        if sp.bbox and result_map.get(sp.bbox):
            bbox = parse_bbox(str(result_map[sp.bbox]))
            if bbox:
                response["bbox"] = bbox
                response["x"] = (bbox["x_min"] + bbox["x_max"]) / 2
                response["y"] = (bbox["y_min"] + bbox["y_max"]) / 2

        # Explicit x/y centroids (override bbox center if available)
        if sp.x and result_map.get(sp.x) is not None:
            response["x"] = float(result_map[sp.x])
            response["y"] = float(result_map[sp.y])

        return response

    @router.get("/api/obs/{row_index}/detail", response_model=None)
    async def get_obs_detail(row_index: int, state: State) -> dict | JSONResponse:
        """Return all visible obs columns for a single observation (bypasses Mosaic)."""

        def _fetch(row_index: int, state: ViewerState) -> tuple[list[str], tuple] | None:
            with state.store.cursor() as cur:
                cols = [
                    d[0]
                    for d in cur.execute("SELECT * FROM obs_base LIMIT 0").description
                    if d[0] not in state.store._hidden
                ]
                row = cur.execute(
                    f"SELECT {', '.join(cols)} FROM obs_base WHERE __row_index__ = ?",
                    [row_index],
                ).fetchone()
                return (cols, row) if row is not None else None

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(state.executor, _fetch, row_index, state)

        if result is None:
            return JSONResponse({"error": "Observation not found"}, status_code=404)

        cols, row = result
        return dict(zip(cols, (str(v) if v is not None else None for v in row), strict=True))

    @router.get("/api/health")
    async def health(state: State) -> dict:
        return {
            "status": "ok",
            "n_obs": state.store.n_obs,
            "loaded_embeddings": list(state.store.loaded_embeddings.keys()),
            "available_embeddings": state.available_obsm_keys,
        }

    return router
