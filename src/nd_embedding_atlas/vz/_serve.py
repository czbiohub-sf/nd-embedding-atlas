"""Launch the embedding-atlas viewer."""

from __future__ import annotations

import asyncio
import concurrent.futures
import dataclasses
import pathlib
import re
import uuid
from typing import TYPE_CHECKING, Any

import numpy as np
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from nd_embedding_atlas._server import build_parquet_bytes, create_cors_app, get_package_version, mount_frontend
from nd_embedding_atlas.vz._duckdb import EmbeddingStore, mount_duckdb_endpoints
from nd_embedding_atlas.vz._export import export_subset
from nd_embedding_atlas.vz._prepare import _obsm_column_prefix, prepare_obs

if TYPE_CHECKING:
    from nd_embedding_atlas.io import AnnDataCollection
    from nd_embedding_atlas.io._config import NdeaConfig


class ExportRequest(BaseModel):
    """Request body for the export endpoint."""

    predicate: str
    filename: str = "export"
    selection_type: str = "unknown"
    embedding_key: str | None = None


@dataclasses.dataclass
class ExportTaskState:
    """Typed state for the single-slot background export task."""

    task_id: str
    task: asyncio.Task[None]
    status: str = "running"  # "running" | "done" | "error"
    output_path: str | None = None
    n_obs: int | None = None
    error: str | None = None


def _read_plate_metadata(plate_path: str | pathlib.Path | None) -> dict | None:
    """Read pixel scale, shape, and channel info from an OME-Zarr plate.

    Delegates to ``ndimg.get_plate_metadata`` for robust v0.4/v0.5 handling.
    """
    if plate_path is None:
        return None
    try:
        from nd_embedding_atlas.ndimg._metadata import get_plate_metadata

        meta = get_plate_metadata(plate_path)
    except Exception:  # noqa: BLE001
        return None

    result: dict = {}
    if "pixel_scale" in meta:
        result["pixel_scale"] = meta["pixel_scale"]
    if "scale" in meta:
        result["scale"] = meta["scale"]
    if "shape" in meta:
        result["shape"] = meta["shape"]
    if meta.get("channels"):
        result["channels"] = [
            {
                "label": ch.get("label", f"Channel {i}"),
                "color": ch.get("color", "FFFFFF"),
                "window": ch.get("window", {}),
            }
            for i, ch in enumerate(meta["channels"])
        ]
    return result or None


def create_app(
    collection: AnnDataCollection,
    *,
    obs_columns: list[str] | None = None,
    plate_path: str | pathlib.Path | None = None,
    static_dir: str | pathlib.Path | None = None,
    export_dir: str | pathlib.Path | None = None,
    columns_config: NdeaConfig | None = None,
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
    export_dir
        Directory for exported zarr stores. Defaults to ``exports/`` in the
        current working directory.
    columns_config
        Parsed YAML column mapping. If provided, spatial column names are
        taken from the config instead of auto-detected.

    Returns
    -------
    FastAPI app ready for ``uvicorn.run()``.
    """
    resolved_export_dir = pathlib.Path(export_dir).resolve() if export_dir else pathlib.Path.cwd() / "exports"

    app = create_cors_app()

    # ── Resolve spatial columns (config > auto-detect) ─────────────────
    _all_obs_cols = set(collection.obs.keys())

    if columns_config and columns_config.columns:
        cm = columns_config.columns
        _fov_col = cm.fov
        _t_col = cm.t
        _bbox_col = cm.bbox
        _x_col = cm.x
        _y_col = cm.y
    else:
        # Fallback: auto-detect from obs column names
        _fov_col = "fov_name" if "fov_name" in _all_obs_cols else ("well" if "well" in _all_obs_cols else None)
        _t_col = "t" if "t" in _all_obs_cols else None
        _bbox_col = "bbox" if "bbox" in _all_obs_cols else ("cp_bbox" if "cp_bbox" in _all_obs_cols else None)
        _x_col = _y_col = None
        for _xc, _yc in [("x", "y"), ("x_cp1", "y_cp1"), ("x_global_pheno", "y_global_pheno")]:
            if _xc in _all_obs_cols and _yc in _all_obs_cols:
                _x_col, _y_col = _xc, _yc
                break

    # Ensure spatial columns are always loaded (needed by /api/cell)
    if obs_columns is not None and plate_path is not None:
        spatial = {c for c in [_fov_col, _t_col, _bbox_col, _x_col, _y_col] if c is not None}
        obs_columns = list(dict.fromkeys([*obs_columns, *sorted(spatial)]))

    # Only hide bbox strings from the Mosaic dataset VIEW — keep fov, t, x, y
    # visible so the frontend trajectory query can access them.
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
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=8)
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
            "version": get_package_version(),
            "props": embedding_props,
            "database": {"type": "rest"},
            "obsm": _build_obsm_metadata(),
            "obs_columns": obs_column_names,
            "plate": has_plate,
            "export_dir": str(resolved_export_dir),
        }
        if plate_meta:
            if "pixel_scale" in plate_meta:
                result["plate_pixel_scale"] = plate_meta["pixel_scale"]
            if "channels" in plate_meta:
                result["plate_channels"] = plate_meta["channels"]
            if "shape" in plate_meta:
                result["plate_shape"] = plate_meta["shape"]
            if "scale" in plate_meta:
                result["plate_scale"] = plate_meta["scale"]
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
            with store.cursor() as cur:
                parquet_cache["data"] = build_parquet_bytes(cur)
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

    # ── Export endpoints ────────────────────────────────────────────────
    # Single-slot: only one export at a time.
    export_task: ExportTaskState | None = None

    def _sanitize_filename(name: str) -> str:
        """Strip path separators and replace non-alphanumeric chars (except _ - .)."""
        name = name.replace("/", "").replace("\\", "").replace("\x00", "")
        name = re.sub(r"[^\w\-.]", "_", name)
        return name or "export"

    def _run_export(indices: np.ndarray, request: ExportRequest) -> dict[str, Any]:
        """Run export in thread pool. Returns result dict."""
        filename = _sanitize_filename(request.filename)
        resolved_export_dir.mkdir(parents=True, exist_ok=True)
        output_path = resolved_export_dir / f"{filename}.zarr"

        export_subset(
            collection,
            indices,
            output_path,
            selection_type=request.selection_type,
            embedding_key=request.embedding_key,
        )
        return {"output_path": str(output_path), "n_obs": len(indices)}

    async def _export_bg(indices: np.ndarray, request: ExportRequest) -> None:
        """Background coroutine for export."""
        try:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(executor, _run_export, indices, request)
            export_task.status = "done"
            export_task.output_path = result["output_path"]
            export_task.n_obs = result["n_obs"]
        except Exception as e:  # noqa: BLE001
            export_task.status = "error"
            export_task.error = str(e)

    def _query_indices(predicate: str) -> np.ndarray:
        """Query DuckDB for row indices matching predicate (runs in thread pool).

        Note: this executes user-provided SQL, consistent with the existing
        ``/data/query`` endpoint which already executes arbitrary Mosaic SQL.
        """
        with store.cursor() as cur:
            result = cur.execute(f"SELECT __row_index__ FROM dataset WHERE {predicate}")
            rows = result.fetchall()
        return np.array([r[0] for r in rows], dtype=np.int64)

    @app.post("/api/export")
    async def start_export(request: ExportRequest) -> JSONResponse:
        nonlocal export_task

        # Check for concurrent export
        if export_task is not None and not export_task.task.done():
            return JSONResponse(
                {"error": "An export is already in progress"},
                status_code=409,
            )

        # Validate predicate by querying for indices
        loop = asyncio.get_running_loop()
        try:
            indices = await loop.run_in_executor(executor, _query_indices, request.predicate)
        except Exception as e:  # noqa: BLE001
            return JSONResponse({"error": f"Invalid predicate: {e}"}, status_code=400)

        if len(indices) == 0:
            return JSONResponse({"error": "No observations match the predicate"}, status_code=400)

        if int(np.max(indices)) >= store.n_obs:
            return JSONResponse(
                {"error": f"Row index out of bounds: max={int(np.max(indices))}, n_obs={store.n_obs}"},
                status_code=400,
            )

        # Start background export (atomic assignment replaces prior state)
        task_id = uuid.uuid4().hex[:12]
        bg = asyncio.create_task(_export_bg(indices, request))
        export_task = ExportTaskState(task_id=task_id, task=bg)

        return JSONResponse({"task_id": task_id, "status": "running"}, status_code=202)

    @app.get("/api/export/{task_id}/status")
    async def export_status(task_id: str) -> JSONResponse:
        if export_task is None or export_task.task_id != task_id:
            return JSONResponse({"error": "Export task not found"}, status_code=404)

        if export_task.status == "running":
            return JSONResponse({"status": "running"})
        if export_task.status == "error":
            return JSONResponse({"status": "error", "error": export_task.error or "Unknown error"})
        if export_task.status == "done":
            return JSONResponse(
                {
                    "status": "done",
                    "output_path": export_task.output_path,
                    "n_obs": export_task.n_obs,
                }
            )
        return JSONResponse({"status": export_task.status})

    # ── Cell crop viewer endpoint ─────────────────────────────────────
    if has_plate:

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

            with store.cursor() as cur:
                row = cur.execute(
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

    from fastapi.staticfiles import StaticFiles

    # Serve OME-Zarr plate as static files (must be before the catch-all "/" mount)
    if plate_path is not None:
        app.mount("/plate", StaticFiles(directory=str(plate_path)), name="plate")

    mount_frontend(app, static_dir=static_dir)

    return app


def serve(
    collection: AnnDataCollection,
    *,
    obs_columns: list[str] | None = None,
    plate_path: str | pathlib.Path | None = None,
    static_dir: str | pathlib.Path | None = None,
    export_dir: str | pathlib.Path | None = None,
    columns_config: NdeaConfig | None = None,
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
    export_dir
        Directory for exported zarr stores. Defaults to ``exports/`` in CWD.
    columns_config
        Parsed YAML column mapping. See :func:`create_app`.
    host, port
        Server bind address.
    """
    app = create_app(
        collection,
        obs_columns=obs_columns,
        plate_path=plate_path,
        static_dir=static_dir,
        export_dir=export_dir,
        columns_config=columns_config,
    )
    print(f"nd-embedding-atlas viewer: http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, access_log=False)
