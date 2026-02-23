"""Launch the embedding-atlas viewer."""

from __future__ import annotations

import asyncio
import concurrent.futures
import importlib.metadata
import importlib.resources
import pathlib
from typing import TYPE_CHECKING, Any

import numpy as np
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from nd_embedding_atlas.vz._duckdb import EmbeddingStore, mount_duckdb_endpoints
from nd_embedding_atlas.vz._prepare import _obsm_column_prefix, prepare_obs

if TYPE_CHECKING:
    from nd_embedding_atlas.io import AnnDataCollection


def _resolve_frontend() -> str:
    """Resolve frontend static directory (dev or bundled).

    Resolution order:

    1. **Dev** -- walk up from this file to find ``frontend/dist/``
       (works with editable installs).
    2. **Bundled** -- ``importlib.resources`` looks for ``nd_embedding_atlas/_frontend/``
       inside the installed wheel.

    Raises
    ------
    FileNotFoundError
        If neither location contains a built frontend.
    """
    # 1. Dev: walk up to find frontend/dist/ (editable install)
    p = pathlib.Path(__file__).resolve()
    for parent in p.parents:
        dist = parent / "frontend" / "dist"
        if dist.is_dir():
            return str(dist)

    # 2. Bundled: importlib.resources (wheel install)
    ref = importlib.resources.files("nd_embedding_atlas") / "_frontend"
    if ref.is_dir():
        return str(ref)

    msg = (
        "No frontend found. Either:\n"
        "  - Run `cd frontend && pnpm install && pnpm build` (development)\n"
        "  - Install from wheel: `uv pip install nd-embedding-atlas`"
    )
    raise FileNotFoundError(msg)


def _read_plate_metadata(plate_path: str | pathlib.Path | None) -> dict | None:
    """Read pixel scale and channel info from the first FOV in an OME-Zarr plate."""
    if plate_path is None:
        return None
    import json

    plate_root = pathlib.Path(plate_path)
    zarr_json = plate_root / "zarr.json"
    if not zarr_json.exists():
        return None
    attrs = json.loads(zarr_json.read_text()).get("attributes", {})
    wells = attrs.get("ome", {}).get("plate", {}).get("wells", [])
    if not wells:
        return None
    well_path = plate_root / wells[0]["path"]
    well_zarr = well_path / "zarr.json"
    if not well_zarr.exists():
        return None
    well_attrs = json.loads(well_zarr.read_text()).get("attributes", {})
    images = well_attrs.get("ome", {}).get("well", {}).get("images", [])
    if not images:
        return None
    fov_path = well_path / images[0]["path"]
    fov_zarr = fov_path / "zarr.json"
    if not fov_zarr.exists():
        return None
    fov_attrs = json.loads(fov_zarr.read_text()).get("attributes", {})

    result: dict = {}

    # Pixel scale
    multiscales = fov_attrs.get("ome", {}).get("multiscales", [])
    if multiscales:
        axes = multiscales[0].get("axes", [])
        datasets = multiscales[0].get("datasets", [])
        if datasets:
            scale = datasets[0].get("coordinateTransformations", [{}])[0].get("scale", [])
            if len(scale) == len(axes):
                axis_names = [a["name"].upper() for a in axes]
                pixel_scale = {}
                for name, s in zip(axis_names, scale, strict=True):
                    if name in ("Y", "X"):
                        pixel_scale[name.lower()] = s
                if pixel_scale:
                    result["pixel_scale"] = pixel_scale

    # Channel info from omero metadata
    omero = fov_attrs.get("ome", {}).get("omero", {})
    channels = omero.get("channels", [])
    if channels:
        result["channels"] = [
            {
                "label": ch.get("label", f"Channel {i}"),
                "color": ch.get("color", "FFFFFF"),
                "window": ch.get("window", {}),
            }
            for i, ch in enumerate(channels)
        ]

    return result or None


def create_app(
    collection: AnnDataCollection,
    *,
    obs_columns: list[str] | None = None,
    plate_path: str | pathlib.Path | None = None,
    static_dir: str | pathlib.Path | None = None,
) -> FastAPI:
    """Create a FastAPI app that loads embeddings on demand.

    On startup, only obs metadata is materialized into DuckDB.  The default
    embedding (first match from :attr:`EmbeddingStore.DEFAULT_OBSM_PRIORITY`)
    is loaded eagerly.  Additional embeddings are loaded via
    ``POST /api/embeddings/{key}`` and polled via
    ``GET /api/embeddings/{key}/status``.

    Parameters
    ----------
    collection
        The AnnDataCollection to serve.  The server holds a reference for
        on-demand obsm access.
    obs_columns
        Subset of ``.obs`` columns to include. ``None`` includes all columns.
    plate_path
        Path to an OME-Zarr plate directory. If provided, serves it at
        ``/plate/`` and enables the ``/api/cell/{row_index}`` endpoint
        for the cell crop viewer.
    static_dir
        Directory to serve as the frontend. ``None`` uses the custom React
        frontend at ``frontend/dist/`` if available, else embedding-atlas's
        bundled frontend.

    Returns
    -------
    FastAPI app ready for ``uvicorn.run()``.
    """
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    # ── Auto-detect spatial columns (from full obs, before filtering) ─
    _all_obs_cols = set(collection.obs.keys())

    # FOV column: fov_name > well
    _fov_col = "fov_name" if "fov_name" in _all_obs_cols else ("well" if "well" in _all_obs_cols else None)

    # Time column: t (if absent, default 0 at query time)
    _t_col = "t" if "t" in _all_obs_cols else None

    # Bbox column: bbox > cp_bbox (bbox = phenotyping segmentation, cp_bbox = CellProfiler)
    _bbox_col = "bbox" if "bbox" in _all_obs_cols else ("cp_bbox" if "cp_bbox" in _all_obs_cols else None)

    # Centroid columns: x/y > x_cp1/y_cp1 > x_global_pheno/y_global_pheno
    _x_col = _y_col = None
    for _xc, _yc in [("x", "y"), ("x_cp1", "y_cp1"), ("x_global_pheno", "y_global_pheno")]:
        if _xc in _all_obs_cols and _yc in _all_obs_cols:
            _x_col, _y_col = _xc, _yc
            break

    # Ensure spatial columns are always loaded (needed by /api/cell)
    if obs_columns is not None and plate_path is not None:
        spatial = {c for c in [_fov_col, _t_col, _bbox_col, _x_col, _y_col] if c is not None}
        obs_columns = list(dict.fromkeys([*obs_columns, *sorted(spatial)]))

    # Determine which spatial columns should be hidden from Mosaic.
    # Keep fov_col, t_col, x_col, y_col visible — they're needed for trajectory queries
    # and tooltips. Only hide bbox (serialized bounding box string, not useful for queries).
    _hidden_cols: set[str] = set()
    if plate_path is not None:
        _hidden_cols = {c for c in [_bbox_col] if c is not None}

    # Materialize obs only
    obs_df = prepare_obs(collection, obs_columns=obs_columns)
    store = EmbeddingStore(obs_df, hidden_columns=_hidden_cols)

    # Mount Mosaic query endpoints on the store's connection
    mount_duckdb_endpoints(app, store.con)

    # Discover available obsm keys from the collection
    available_obsm_keys: list[str] = list(collection.obsm.keys())

    # Pick default embedding and load eagerly
    default_key: str | None = None
    for candidate in EmbeddingStore.DEFAULT_OBSM_PRIORITY:
        if candidate in available_obsm_keys:
            default_key = candidate
            break
    if default_key is None and available_obsm_keys:
        default_key = available_obsm_keys[0]

    if default_key is not None:
        coords = collection.obsm[default_key]
        if hasattr(coords, "compute"):
            coords = coords.compute()
        store.register_embedding(default_key, np.asarray(coords, dtype=np.float32))

    # Background task management
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
    loading_tasks: dict[str, asyncio.Task[None]] = {}
    load_errors: dict[str, str] = {}

    # Parquet cache (invalidated when new embeddings load)
    parquet_cache: dict[str, bytes | None] = {"data": None}

    def _materialize_embedding(key: str) -> np.ndarray:
        """Materialize an obsm key (runs in thread pool)."""
        coords = collection.obsm[key]
        if hasattr(coords, "persist"):
            coords = coords.persist()
        if hasattr(coords, "compute"):
            coords = coords.compute()
        return np.asarray(coords, dtype=np.float32)

    async def _load_embedding_bg(key: str) -> None:
        """Background coroutine to load an embedding."""
        try:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(executor, _materialize_embedding, key)
            store.register_embedding(key, result)
            parquet_cache["data"] = None  # invalidate
        except Exception as e:
            load_errors[key] = str(e)
            raise

    # ── Endpoints ─────────────────────────────────────────────────────

    def _build_obsm_metadata() -> dict[str, Any]:
        """Build obsm metadata dict including loaded status."""
        meta: dict[str, Any] = {}
        for key in available_obsm_keys:
            prefix = _obsm_column_prefix(key)
            if key in store.loaded_embeddings:
                info = store.loaded_embeddings[key]
                meta[key] = {"prefix": prefix, "n_dims": info["n_dims"], "loaded": True}
            else:
                meta[key] = {"prefix": prefix, "n_dims": None, "loaded": False}
        return meta

    # Determine default x/y columns
    if default_key is not None and default_key in store.loaded_embeddings:
        info = store.loaded_embeddings[default_key]
        default_x = f"{info['prefix']}_0"
        default_y = f"{info['prefix']}_1"
    else:
        default_x = "x"
        default_y = "y"

    id_column = "__row_index__"
    obs_column_names = [c for c in obs_df.columns if c != "__row_index__" and c not in _hidden_cols]
    embedding_props = {
        "data": {
            "id": id_column,
            "projection": {"x": default_x, "y": default_y},
        },
    }

    has_plate = plate_path is not None
    plate_meta = _read_plate_metadata(plate_path) if has_plate else None

    @app.get("/data/metadata.json")
    async def get_metadata() -> dict:
        result: dict = {
            "version": importlib.metadata.version("nd-embedding-atlas"),
            "props": embedding_props,
            "database": {"type": "rest"},
            "obsm": _build_obsm_metadata(),
            "obs_columns": obs_column_names,
            "plate": has_plate,
        }
        if plate_meta:
            if "pixel_scale" in plate_meta:
                result["plate_pixel_scale"] = plate_meta["pixel_scale"]
            if "channels" in plate_meta:
                result["plate_channels"] = plate_meta["channels"]
        result["spatial"] = {
            "fov_col": _fov_col,
            "t_col": _t_col,
            "bbox_col": _bbox_col,
            "x_col": _x_col,
            "y_col": _y_col,
        }
        return result

    @app.get("/data/dataset.parquet")
    async def get_parquet() -> Response:
        if parquet_cache["data"] is None:
            import pyarrow.parquet as pq

            table = store.con.sql("SELECT * FROM dataset").arrow()
            import pyarrow as pa

            sink = pa.BufferOutputStream()
            pq.write_table(table, sink)
            parquet_cache["data"] = sink.getvalue().to_pybytes()
        return Response(parquet_cache["data"], media_type="application/octet-stream")

    @app.post("/api/embeddings/{key}")
    async def load_embedding(key: str) -> JSONResponse:
        if key not in available_obsm_keys:
            return JSONResponse({"error": f"Unknown obsm key: {key}"}, status_code=404)
        if key in store.loaded_embeddings:
            return JSONResponse({"status": "ready"})
        if key in loading_tasks and not loading_tasks[key].done():
            return JSONResponse({"status": "loading"}, status_code=202)

        task = asyncio.create_task(_load_embedding_bg(key))
        loading_tasks[key] = task
        return JSONResponse({"status": "loading"}, status_code=202)

    @app.get("/api/embeddings/{key}/status")
    async def embedding_status(key: str) -> JSONResponse:
        if key in store.loaded_embeddings:
            return JSONResponse({"status": "ready"})
        if key in loading_tasks:
            task = loading_tasks[key]
            if not task.done():
                return JSONResponse({"status": "loading"})
            if task.cancelled() or key in load_errors:
                error_msg = load_errors.get(key, "Task cancelled")
                return JSONResponse({"status": "error", "error": error_msg}, status_code=500)
            return JSONResponse({"status": "ready"})
        return JSONResponse({"status": "not_started"})

    @app.get("/api/health")
    async def health() -> dict:
        return {
            "status": "ok",
            "n_obs": store.n_obs,
            "loaded_embeddings": list(store.loaded_embeddings.keys()),
            "available_embeddings": available_obsm_keys,
        }

    # ── Cell crop viewer endpoints ────────────────────────────────────
    if has_plate:

        @app.get("/api/cell/lookup", response_model=None)
        async def lookup_cell(fov_name: str, track_id: int, t: int) -> dict | JSONResponse:
            """Look up spatial coordinates for a specific (fov_name, track_id, t) triple."""
            if not (_fov_col and _x_col and _y_col):
                return JSONResponse({"error": "Spatial columns not configured"}, status_code=500)

            select_cols = [_x_col, _y_col]
            if _bbox_col:
                select_cols.append(_bbox_col)

            where = f"{_fov_col} = ? AND track_id = ? AND {_t_col} = ?" if _t_col else f"{_fov_col} = ? AND track_id = ?"
            params: list = [fov_name, track_id, t] if _t_col else [fov_name, track_id]

            row = store.con.execute(
                f"SELECT {', '.join(select_cols)} FROM obs_base WHERE {where} LIMIT 1",
                params,
            ).fetchone()
            if row is None:
                return JSONResponse({"error": "Cell not found"}, status_code=404)

            result_map = dict(zip(select_cols, row, strict=True))
            response: dict = {"x": float(result_map[_x_col]), "y": float(result_map[_y_col])}

            if _bbox_col and result_map.get(_bbox_col):
                parts = str(result_map[_bbox_col]).strip("[]").split()
                if len(parts) == 4:
                    y_min, x_min, y_max, x_max = (float(v) for v in parts)
                    response["bbox"] = {"y_min": y_min, "x_min": x_min, "y_max": y_max, "x_max": x_max}

            return response

        @app.get("/api/cell/{row_index}", response_model=None)
        async def get_cell(row_index: int) -> dict | JSONResponse:
            """Look up spatial coordinates for a cell by row index."""
            select_cols = []
            if _fov_col:
                select_cols.append(_fov_col)
            if _t_col:
                select_cols.append(_t_col)
            if _bbox_col:
                select_cols.append(_bbox_col)
            if _x_col:
                select_cols.extend([_x_col, _y_col])

            if not select_cols:
                return JSONResponse({"error": "No spatial columns found"}, status_code=500)

            row = store.con.execute(
                f"SELECT {', '.join(select_cols)} FROM obs_base WHERE __row_index__ = ?",
                [row_index],
            ).fetchone()
            if row is None:
                return JSONResponse({"error": "Cell not found"}, status_code=404)

            result_map = dict(zip(select_cols, row, strict=True))
            response: dict = {}

            # fov_name (normalize from whatever source column)
            if _fov_col:
                response["fov_name"] = str(result_map[_fov_col])

            # t (default 0 when column is absent)
            response["t"] = int(result_map[_t_col]) if _t_col else 0

            # bbox parsing: "[44055 98779 44238 98919]" → {y_min, x_min, y_max, x_max}
            if _bbox_col and result_map.get(_bbox_col):
                parts = str(result_map[_bbox_col]).strip("[]").split()
                if len(parts) == 4:
                    y_min, x_min, y_max, x_max = (float(v) for v in parts)
                    response["bbox"] = {"y_min": y_min, "x_min": x_min, "y_max": y_max, "x_max": x_max}
                    # Provide centroid from bbox center as fallback x/y
                    response["x"] = (x_min + x_max) / 2
                    response["y"] = (y_min + y_max) / 2

            # Explicit x/y centroids (override bbox center if available)
            if _x_col and result_map.get(_x_col) is not None:
                response["x"] = float(result_map[_x_col])
                response["y"] = float(result_map[_y_col])

            return response

    # Resolve which frontend to serve
    if static_dir is not None:
        resolved_static = str(static_dir)
    else:
        resolved_static = _resolve_frontend()

    from fastapi.staticfiles import StaticFiles

    # Serve OME-Zarr plate as static files (must be before the catch-all "/" mount)
    if plate_path is not None:
        app.mount("/plate", StaticFiles(directory=str(plate_path)), name="plate")

    app.mount("/", StaticFiles(directory=resolved_static, html=True))

    return app


def serve(
    collection: AnnDataCollection,
    *,
    obs_columns: list[str] | None = None,
    plate_path: str | pathlib.Path | None = None,
    static_dir: str | pathlib.Path | None = None,
    host: str = "localhost",
    port: int = 5055,
) -> None:
    """Launch the viewer — loads embeddings on demand.

    Parameters
    ----------
    collection
        The AnnDataCollection to serve.
    obs_columns
        Subset of ``.obs`` columns to include.
    plate_path
        Path to an OME-Zarr plate for the cell crop viewer.
    static_dir
        Frontend directory to serve. See :func:`create_app` for resolution logic.
    host, port
        Server bind address.
    """
    app = create_app(collection, obs_columns=obs_columns, plate_path=plate_path, static_dir=static_dir)
    print(f"nd-embedding-atlas viewer: http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, access_log=False)
