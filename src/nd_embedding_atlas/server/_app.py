"""FastAPI app factory and server launcher."""

from __future__ import annotations

import pathlib
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

import numpy as np
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from nd_embedding_atlas._server import create_cors_app, mount_frontend
from nd_embedding_atlas.server._state import DatasetConfig, ViewerState
from nd_embedding_atlas.server._store import EmbeddingStore
from nd_embedding_atlas.server.routes._data import make_colormaps_router, make_data_router
from nd_embedding_atlas.server.routes._embeddings import make_embeddings_router
from nd_embedding_atlas.server.routes._export import make_export_router
from nd_embedding_atlas.server.routes._mosaic import make_mosaic_router
from nd_embedding_atlas.server.routes._obs import make_obs_router
from nd_embedding_atlas.server.routes._scatter import make_scatter_router
from nd_embedding_atlas.vz._prepare import detect_spatial_columns, prepare_obs

if TYPE_CHECKING:
    from nd_embedding_atlas.io import AnnDataCollection
    from nd_embedding_atlas.io._config import NdeaConfig


def _read_plate_metadata(plate_path: str | pathlib.Path | None) -> dict[str, Any] | None:
    """Read pixel scale, shape, and channel info from an OME-Zarr plate.

    Returns a dict with ``plate_*`` prefixed keys ready to merge into
    the metadata response, or ``None`` if unavailable.
    """
    if plate_path is None:
        return None
    try:
        from nd_embedding_atlas.ndimg._metadata import detect_ome_version, get_plate_metadata

        meta = get_plate_metadata(plate_path)
    except Exception:  # noqa: BLE001
        return None

    result: dict[str, Any] = {}
    if "pixel_scale" in meta:
        result["plate_pixel_scale"] = meta["pixel_scale"]
    if "scale" in meta:
        result["plate_scale"] = meta["scale"]
    if "shape" in meta:
        result["plate_shape"] = meta["shape"]
    if meta.get("channels"):
        result["plate_channels"] = [
            {
                "label": ch.get("label", f"Channel {i}"),
                "color": ch.get("color", "FFFFFF"),
                "window": ch.get("window", {}),
            }
            for i, ch in enumerate(meta["channels"])
        ]
    result["plate_ome_version"] = detect_ome_version(plate_path)
    return result


def create_app(
    collection: AnnDataCollection,
    *,
    obs_columns: list[str] | None = None,
    plate_path: str | pathlib.Path | None = None,
    static_dir: str | pathlib.Path | None = None,
    export_dir: str | pathlib.Path | None = None,
    columns_config: NdeaConfig | None = None,
    duckdb_threads: int | None = None,
    pool_workers: int | None = None,
) -> FastAPI:
    """Create a FastAPI app that loads embeddings on demand.

    Parameters
    ----------
    collection
        The AnnDataCollection to serve.
    obs_columns
        Subset of ``.obs`` columns to include. ``None`` includes all.
    plate_path
        Path to an OME-Zarr plate directory for the observation viewer.
    static_dir
        Directory to serve as the frontend.
    export_dir
        Directory for exported zarr stores.
    columns_config
        Parsed YAML column mapping.
    duckdb_threads
        DuckDB internal thread count (default: half of CPU cores).
    pool_workers
        Request handler thread pool size (default: half of CPU cores).
    """
    resolved_export_dir = pathlib.Path(export_dir).resolve() if export_dir else pathlib.Path.cwd() / "exports"

    # ── Resolve spatial columns ───────────────────────────────────────
    spatial = detect_spatial_columns(set(collection.obs.keys()), columns_config=columns_config)

    # Ensure spatial columns are always loaded (needed by /api/obs)
    if obs_columns is not None and plate_path is not None:
        obs_columns = list(dict.fromkeys([*obs_columns, *sorted(spatial.all_columns)]))

    # ── Build store ───────────────────────────────────────────────────
    try:
        from pyinstrument import Profiler as _Profiler

        _profiler = _Profiler(interval=0.001)
        _profiler.start()
    except ImportError:
        _profiler = None

    has_plate = plate_path is not None
    plate_meta = _read_plate_metadata(plate_path) if has_plate else None

    obs_df = prepare_obs(collection, obs_columns=obs_columns)
    hidden_cols = spatial.hidden if plate_path else set()
    store = EmbeddingStore(
        obs_df,
        hidden_columns=hidden_cols,
        duckdb_threads=duckdb_threads,
        pool_workers=pool_workers,
    )

    # Discover available obsm keys
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

    if _profiler is not None:
        _profiler.stop()
        _profiler.print()

    # ── Build state ───────────────────────────────────────────────────
    state = ViewerState(
        collection,
        store,
        available_obsm_keys=available_obsm_keys,
        spatial=spatial,
        export_dir=resolved_export_dir,
    )

    # ── Build dataset config ──────────────────────────────────────────
    if default_key is not None and default_key in store.loaded_embeddings:
        info = store.loaded_embeddings[default_key]
        default_x = f"{info['prefix']}_0"
        default_y = f"{info['prefix']}_1"
    else:
        default_x = "x"
        default_y = "y"

    obs_column_names = [c for c in obs_df.columns if c != "__row_index__" and c not in hidden_cols]

    config = DatasetConfig(
        obs_column_names=obs_column_names,
        embedding_props={
            "data": {
                "id": "__row_index__",
                "projection": {"x": default_x, "y": default_y},
            },
        },
        has_plate=has_plate,
        plate_meta=plate_meta,
        default_x=default_x,
        default_y=default_y,
    )

    # ── Assemble app ──────────────────────────────────────────────────
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Dedicate more threads to file I/O (zarr chunk serving via StaticFiles).
        # StaticFiles uses anyio's default thread pool; DuckDB queries use state.executor separately.
        import anyio

        anyio.to_thread.current_default_thread_limiter().total_tokens = 32
        yield
        state.shutdown()

    app = create_cors_app()
    app.router.lifespan_context = lifespan

    def get_state() -> ViewerState:
        return state

    app.include_router(make_mosaic_router(get_state))
    app.include_router(make_data_router(get_state, config))
    app.include_router(make_colormaps_router())
    app.include_router(make_embeddings_router(get_state))
    app.include_router(make_export_router(get_state))
    app.include_router(make_obs_router(get_state))
    app.include_router(make_scatter_router(get_state))

    if plate_path is not None:
        app.mount("/plate", StaticFiles(directory=str(plate_path)), name="plate")

    mount_frontend(app, static_dir=static_dir)

    # ── Optional profiling ────────────────────────────────────────────
    try:
        from pyinstrument.middleware import ProfilerMiddleware

        app.add_middleware(ProfilerMiddleware, html=True, open_in_browser=False, interval=0.001)
    except ImportError:
        pass

    return app


def serve(
    collection: AnnDataCollection,
    *,
    obs_columns: list[str] | None = None,
    plate_path: str | pathlib.Path | None = None,
    static_dir: str | pathlib.Path | None = None,
    export_dir: str | pathlib.Path | None = None,
    columns_config: NdeaConfig | None = None,
    duckdb_threads: int | None = None,
    pool_workers: int | None = None,
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
        Path to an OME-Zarr plate for the observation viewer.
    static_dir
        Frontend directory to serve.
    export_dir
        Directory for exported zarr stores.
    columns_config
        Parsed YAML column mapping.
    duckdb_threads
        DuckDB internal thread count.
    pool_workers
        Request handler thread pool size.
    host, port
        Server bind address.
    """
    import uvicorn

    app = create_app(
        collection,
        obs_columns=obs_columns,
        plate_path=plate_path,
        static_dir=static_dir,
        export_dir=export_dir,
        columns_config=columns_config,
        duckdb_threads=duckdb_threads,
        pool_workers=pool_workers,
    )
    print(f"nd-embedding-atlas viewer: http://{host}:{port}")

    uvicorn.run(app, host=host, port=port, access_log=False)
