"""Dataset metadata and parquet endpoints."""

import asyncio
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from nd_embedding_atlas._server import build_parquet_bytes, get_package_version
from nd_embedding_atlas.server._state import DatasetConfig, ViewerState
from nd_embedding_atlas.vz._prepare import _obsm_column_prefix


def _safe_var_count(collection: "Any") -> int:  # type: ignore[type-arg]
    """Return var count without triggering ad.concat on lazy multi-dataset collections."""
    try:
        return len(collection.var_names)
    except Exception:  # noqa: BLE001
        return 0


def _build_obsm_metadata(state: ViewerState) -> dict[str, Any]:
    """Build obsm metadata dict including loaded status."""
    meta: dict[str, Any] = {}
    for key in state.available_obsm_keys:
        prefix = _obsm_column_prefix(key)
        if key in state.store.loaded_embeddings:
            info = state.store.loaded_embeddings[key]
            meta[key] = {"prefix": prefix, "n_dims": info["n_dims"], "loaded": True}
        else:
            meta[key] = {"prefix": prefix, "n_dims": None, "loaded": False}
    return meta


def make_colormaps_router() -> APIRouter:
    """Return an APIRouter for colormap utility endpoints (stateless)."""
    router = APIRouter()

    @router.get("/data/colormaps")
    async def get_colormaps() -> dict:
        from nd_embedding_atlas.io._colors import list_continuous_colormaps, list_qualitative_colormaps

        return {
            "categorical": list_qualitative_colormaps(),
            "continuous": list_continuous_colormaps(),
        }

    @router.get("/data/categorical-palette")
    async def get_categorical_palette(colormap: str = "tab20", n: int = 64) -> dict:
        from nd_embedding_atlas.io._colors import make_categorical_palette

        if n < 1 or n > 256:
            msg = "n must be between 1 and 256"
            raise HTTPException(status_code=400, detail=msg)
        try:
            colors = make_categorical_palette(colormap, n)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"colors": colors}

    return router


def make_data_router(get_state: Callable[[], ViewerState], config: DatasetConfig) -> APIRouter:
    """Return an APIRouter for ``/data/metadata.json`` and ``/data/dataset.parquet``."""
    router = APIRouter()
    State = Annotated[ViewerState, Depends(get_state)]

    @router.get("/data/metadata.json")
    async def get_metadata(state: State) -> dict:
        try:
            layer_keys = list(state.collection._concat.layers.keys())
        except Exception:  # noqa: BLE001
            layer_keys = []

        result: dict = {
            "version": get_package_version(),
            "props": config.embedding_props,
            "database": {"type": "rest"},
            "obsm": _build_obsm_metadata(state),
            "obs_columns": config.obs_column_names,
            "plate": config.has_plate,
            "export_dir": str(state.export_dir),
            "var_count": _safe_var_count(state.collection),
            "layers": ["X", *layer_keys],
        }
        if config.plate_meta:
            result.update(config.plate_meta)
        if config.dataset_keys is not None:
            result["dataset_keys"] = config.dataset_keys
        result["spatial"] = {
            "fov_col": state.spatial.fov,
            "t_col": state.spatial.t,
            "bbox_col": state.spatial.bbox,
            "x_col": state.spatial.x,
            "y_col": state.spatial.y,
        }
        return result

    @router.get("/data/dataset.parquet")
    async def get_parquet(state: State) -> Response:
        if state.parquet_cache is None:

            def _build() -> bytes:
                with state.store.cursor() as cur:
                    return build_parquet_bytes(cur)

            state.parquet_cache = await asyncio.get_running_loop().run_in_executor(state.executor, _build)
        return Response(state.parquet_cache, media_type="application/octet-stream")

    return router
