"""Observation lookup and health endpoints."""

from collections.abc import Callable
from functools import partial
from typing import Annotated

import anyio
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from nd_embedding_atlas.server._state import ViewerState
from nd_embedding_atlas.vz._prepare import parse_bbox


def _lookup_obs(row_index: int, select_cols: list[str], state: ViewerState) -> tuple | None:
    """Query DuckDB for a single observation by row index (runs in thread pool)."""
    # Quote column names to handle special chars (e.g. leiden_0.5 contains a dot)
    quoted = ", ".join(f'"{c}"' for c in select_cols)
    with state.store.cursor() as cur:
        return cur.execute(
            f"SELECT {quoted} FROM obs_base WHERE __row_index__ = ?",
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

        # In multi-dataset mode, prepend _dataset BEFORE the early-exit guard
        # so it's always fetched when available.
        if state.dataset_plates:
            select_cols = ["_dataset", *select_cols]

        if not select_cols:
            return JSONResponse({"error": "No spatial columns configured"}, status_code=404)

        row = await anyio.to_thread.run_sync(partial(_lookup_obs, row_index, select_cols, state), cancellable=True)

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

        # In multi-dataset mode, resolve store_index from _dataset value
        if state.dataset_plates:
            _dataset_val = result_map.get("_dataset")
            dataset_keys = list(state.dataset_plates.keys())
            if _dataset_val is not None and _dataset_val in dataset_keys:
                response["store_index"] = dataset_keys.index(_dataset_val)

        return response

    @router.get("/api/obs/batch", response_model=None)
    async def get_obs_batch(ids: str, state: State) -> JSONResponse:
        """Return x/y centroids for multiple observations in one query.

        Parameters
        ----------
        ids
            Comma-separated row indices (e.g. ``?ids=1,2,3``).
        """
        sp = state.spatial
        x_col = sp.x
        y_col = sp.y

        if not x_col or not y_col:
            return JSONResponse({})

        try:
            row_indices = [int(i) for i in ids.split(",") if i.strip()]
        except ValueError:
            return JSONResponse({"error": "ids must be comma-separated integers"}, status_code=422)

        if not row_indices:
            return JSONResponse({})

        def _batch_lookup(indices: list[int]) -> dict[str, dict]:
            placeholders = ", ".join("?" * len(indices))
            with state.store.cursor() as cur:
                rows = cur.execute(
                    f'SELECT __row_index__, "{x_col}", "{y_col}" FROM obs_base WHERE __row_index__ IN ({placeholders})',
                    indices,
                ).fetchall()
            return {str(r[0]): {"x": float(r[1]), "y": float(r[2])} for r in rows}

        result = await anyio.to_thread.run_sync(partial(_batch_lookup, row_indices), cancellable=True)
        return JSONResponse(result)

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
                # Quote column names to handle dots/special chars (e.g. leiden_0.5)
                quoted = ", ".join(f'"{c}"' for c in cols)
                row = cur.execute(
                    f"SELECT {quoted} FROM obs_base WHERE __row_index__ = ?",
                    [row_index],
                ).fetchone()
                return (cols, row) if row is not None else None

        result = await anyio.to_thread.run_sync(partial(_fetch, row_index, state), cancellable=True)

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
