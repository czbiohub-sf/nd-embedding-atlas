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
from nd_embedding_atlas.server.routes._crops import make_crop_router
from nd_embedding_atlas.server.routes._data import make_colormaps_router, make_data_router
from nd_embedding_atlas.server.routes._embeddings import make_embeddings_router
from nd_embedding_atlas.server.routes._export import make_export_router
from nd_embedding_atlas.server.routes._mosaic import make_mosaic_router
from nd_embedding_atlas.server.routes._obs import make_obs_router
from nd_embedding_atlas.server.routes._obssets import make_obssets_router
from nd_embedding_atlas.server.routes._scatter import make_scatter_router
from nd_embedding_atlas.server.routes._var import make_var_router
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


def _populate_obsset_tables(store: EmbeddingStore, obssets: list[dict]) -> None:
    """Bulk-insert persisted ObsSets and their members into DuckDB.

    Logs a warning for any ObsSet whose member count has drifted from
    the recorded created_count (obs deleted from the dataset since save).
    """
    import logging as _logging

    _log = _logging.getLogger("ndea.obssets")
    con = store.con
    for o in obssets:
        oid = o["obsset_id"]
        members: list[dict] = o.get("members", [])
        created_count: int = o.get("created_count", len(members))

        con.execute(
            "INSERT OR IGNORE INTO obssets (obsset_id, name, color, created_at, created_count) VALUES (?, ?, ?, ?, ?)",
            [oid, o.get("name", ""), o.get("color"), o.get("created_at"), created_count],
        )
        if members:
            rows = [(oid, m["dataset_key"], m["obs_name"]) for m in members]
            con.executemany(
                "INSERT OR IGNORE INTO obsset_members (obsset_id, dataset_key, obs_name) VALUES (?, ?, ?)",
                rows,
            )

        actual_count = con.execute("SELECT COUNT(*) FROM obsset_members WHERE obsset_id = ?", [oid]).fetchone()[0]
        if actual_count != created_count:
            _log.warning(
                "ObsSet %r (%s): created_count=%d but current member count=%d — "
                "obs identity has drifted since last save.",
                oid,
                o.get("name", ""),
                created_count,
                actual_count,
            )


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
    no_static: bool = False,
    dataset_plates: dict[str, pathlib.Path] | None = None,
    project_config_path: pathlib.Path | None = None,
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
    dataset_plates
        Per-dataset plate paths for project mode (key → plate path).
    project_config_path
        Path to the project YAML config (used for sidecar persistence).
    """
    resolved_export_dir = pathlib.Path(export_dir).resolve() if export_dir else pathlib.Path.cwd() / "exports"

    # ── Resolve spatial columns ───────────────────────────────────────
    from nd_embedding_atlas.io._get import get_obs as _get_obs_cols

    _first_obs = _get_obs_cols(collection, include_index=False)
    spatial = detect_spatial_columns(set(_first_obs.columns), columns_config=columns_config)

    # Ensure spatial columns are always loaded (needed by /api/obs)
    if obs_columns is not None and plate_path is not None:
        obs_columns = list(dict.fromkeys([*obs_columns, *sorted(spatial.all_columns)]))

    # In multi-dataset (project) mode, ensure _dataset is always in obs_columns
    # so it's never filtered out during prepare_obs and is available in obs_base.
    if dataset_plates and obs_columns is not None and "_dataset" not in obs_columns:
        obs_columns = ["_dataset", *obs_columns]

    # ── Build store ───────────────────────────────────────────────────
    try:
        from pyinstrument import Profiler as _Profiler

        _profiler = _Profiler(interval=0.001)
        _profiler.start()
    except ImportError:
        _profiler = None

    has_plate = plate_path is not None or bool(dataset_plates)

    # Single-dataset plate metadata
    plate_meta = _read_plate_metadata(plate_path) if plate_path is not None else None

    # Project mode: read per-dataset plate metadata; use first plate as canonical frontend meta
    dataset_channels: dict[str, list[Any]] = {}
    dataset_ome_versions: dict[str, str] = {}
    dataset_pixel_scales: dict[str, dict[str, float]] = {}
    if dataset_plates:
        first_plate_meta: dict[str, Any] | None = None
        for _ds_key, _ds_plate_path in dataset_plates.items():
            _meta = _read_plate_metadata(_ds_plate_path)
            dataset_channels[_ds_key] = _meta.get("plate_channels", []) if _meta else []
            dataset_ome_versions[_ds_key] = _meta.get("plate_ome_version", "0.4") if _meta else "0.4"
            if _meta and "plate_pixel_scale" in _meta:
                dataset_pixel_scales[_ds_key] = _meta["plate_pixel_scale"]
            if first_plate_meta is None:
                first_plate_meta = _meta

        # Log when channel layouts differ across plates (each dataset gets its own channels)
        if len(dataset_channels) > 1:
            channel_counts = {k: len(v) for k, v in dataset_channels.items()}
            if len(set(channel_counts.values())) > 1:
                import logging as _logging

                _logging.getLogger("ndea").info(
                    "Plate channel counts differ across datasets: %s — per-dataset channels will be served.",
                    channel_counts,
                )

        # Use first plate as canonical frontend metadata if no single plate_path given
        if plate_meta is None and first_plate_meta is not None:
            plate_meta = first_plate_meta

    obs_df = prepare_obs(collection, obs_columns=obs_columns)
    hidden_cols = spatial.hidden if plate_path else set()
    store = EmbeddingStore(
        obs_df,
        hidden_columns=hidden_cols,
        duckdb_threads=duckdb_threads,
        pool_workers=pool_workers,
    )

    # Discover available obsm keys
    from nd_embedding_atlas.io._get import _read_adata as _read_adata_store
    from nd_embedding_atlas.io._get import get_obsm as _get_obsm

    _first_entry = next(iter(collection.datasets.data.values()))
    if _first_entry.path is not None:
        _tmp_adata = _read_adata_store(_first_entry.path)
        available_obsm_keys: list[str] = list(_tmp_adata.obsm.keys())
    else:
        available_obsm_keys = list(collection.obsm.keys())

    # Pick default embedding and load eagerly
    default_key: str | None = None
    for candidate in EmbeddingStore.DEFAULT_OBSM_PRIORITY:
        if candidate in available_obsm_keys:
            default_key = candidate
            break
    if default_key is None and available_obsm_keys:
        default_key = available_obsm_keys[0]

    if default_key is not None:
        coords = _get_obsm(collection, default_key)
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
        dataset_plates=dataset_plates,
        dataset_ome_versions=dataset_ome_versions if dataset_ome_versions else None,
        dataset_pixel_scales=dataset_pixel_scales if dataset_pixel_scales else None,
        project_config_path=project_config_path,
    )

    # ── Load persisted ObsSets from sidecar ──────────────────────────
    if project_config_path:
        from nd_embedding_atlas.server._obssets_io import load_obssets, sidecar_path

        _sidecar = sidecar_path(project_config_path)
        _persisted = load_obssets(_sidecar)
        if _persisted:
            _populate_obsset_tables(state.store, _persisted)

    # ── Build dataset config ──────────────────────────────────────────
    if default_key is not None and default_key in store.loaded_embeddings:
        info = store.loaded_embeddings[default_key]
        default_x = f"{info['prefix']}_0"
        default_y = f"{info['prefix']}_1"
    else:
        default_x = "x"
        default_y = "y"

    obs_column_names = [c for c in obs_df.columns if c != "__row_index__" and c not in hidden_cols]

    _dataset_keys: list[str] | None = list(dataset_plates.keys()) if dataset_plates else None

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
        dataset_keys=_dataset_keys,
        dataset_channels=dataset_channels if dataset_channels else None,
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

    app.include_router(
        make_crop_router(
            plate_path,
            plate_meta.get("plate_channels") if plate_meta else None,
            dataset_plates=dataset_plates,
            dataset_channels=dataset_channels if dataset_channels else None,
        )
    )
    app.include_router(make_mosaic_router(get_state))
    app.include_router(make_data_router(get_state, config))
    app.include_router(make_colormaps_router())
    app.include_router(make_embeddings_router(get_state))
    app.include_router(make_export_router(get_state))
    app.include_router(make_obs_router(get_state))
    app.include_router(make_obssets_router(get_state))
    app.include_router(make_scatter_router(get_state))
    app.include_router(make_var_router(get_state))

    # Single-dataset: mount at /plate (unchanged — preserves frontend tile URL compatibility)
    if plate_path is not None:
        app.mount("/plate", StaticFiles(directory=str(plate_path)), name="plate")

    # Project mode: mount each dataset plate at /plates/{key}; also mount the first at /plate
    # as fallback for any hardcoded frontend paths. Frontend multi-plate routing (per _dataset)
    # is deferred to Phase 2.
    if dataset_plates:
        first_mounted = False
        for _key, _ds_plate_path in dataset_plates.items():
            app.mount(f"/plates/{_key}", StaticFiles(directory=str(_ds_plate_path)), name=f"plate_{_key}")
            if not first_mounted and plate_path is None:
                app.mount("/plate", StaticFiles(directory=str(_ds_plate_path)), name="plate")
                first_mounted = True

    if not no_static:
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
    no_static: bool = False,
    dataset_plates: dict[str, pathlib.Path] | None = None,
    project_config_path: pathlib.Path | None = None,
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
    dataset_plates
        Per-dataset plate paths for project mode (key → plate path).
    project_config_path
        Path to the project YAML config (used for sidecar persistence).
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
        no_static=no_static,
        dataset_plates=dataset_plates,
        project_config_path=project_config_path,
    )
    print(f"nd-embedding-atlas viewer: http://{host}:{port}")

    uvicorn.run(app, host=host, port=port, access_log=False)
