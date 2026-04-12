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
    from nd_embedding_atlas.io._config import NdeaConfig
    from nd_embedding_atlas.io._protocol import DataSource


# ── Shared helpers ────────────────────────────────────────────────────────


def _autocontrast_channels(plate_path: str | pathlib.Path, channels: list[dict]) -> list[dict]:
    """Sample a FOV to compute p1/p99.9 contrast limits when OME defaults are bad."""
    import logging

    try:
        import numpy as np
        import zarr

        store = zarr.open(str(plate_path), mode="r")

        # Find first FOV by walking the plate structure
        fov_path = None
        for row_key in sorted(store.keys()):
            if row_key in ("zarr.json", ".zattrs", ".zgroup"):
                continue
            row = store[row_key]
            if not hasattr(row, "keys"):
                continue
            for col_key in sorted(row.keys()):
                col = row[col_key]
                if not hasattr(col, "keys"):
                    continue
                for field_key in sorted(col.keys()):
                    field = col[field_key]
                    if hasattr(field, "keys") and "0" in field:
                        fov_path = f"{row_key}/{col_key}/{field_key}"
                        break
                if fov_path:
                    break
            if fov_path:
                break

        if not fov_path:
            return channels

        # Sample up to 3 FOVs and take max across them for robust contrast
        sample_fovs = [fov_path]
        # Try to find more FOVs for a better sample
        all_fovs: list[str] = []
        for row_key in sorted(store.keys()):
            if row_key in ("zarr.json", ".zattrs", ".zgroup"):
                continue
            row = store[row_key]
            if not hasattr(row, "keys"):
                continue
            for col_key in sorted(row.keys()):
                col = row[col_key]
                if not hasattr(col, "keys"):
                    continue
                for field_key in sorted(col.keys()):
                    field = col[field_key]
                    if hasattr(field, "keys") and "0" in field:
                        all_fovs.append(f"{row_key}/{col_key}/{field_key}")
                if len(all_fovs) > 100:
                    break
            if len(all_fovs) > 100:
                break
        if len(all_fovs) > 3:
            # Pick evenly spaced FOVs for diversity
            step = len(all_fovs) // 3
            sample_fovs = [all_fovs[0], all_fovs[step], all_fovs[-1]]

        # Read a small center crop from each sampled FOV (fast — one chunk per channel)
        all_data = []
        for fp in sample_fovs:
            arr = store[f"{fp}/0"]
            shape = arr.shape
            # Read center 512x512 crop per channel (fits in one chunk typically)
            if arr.ndim == 5:  # T, C, Z, Y, X
                cy, cx = shape[3] // 2, shape[4] // 2
                h = min(512, shape[3])
                w = min(512, shape[4])
                d = np.array(arr[0, :, 0, cy - h // 2 : cy + h // 2, cx - w // 2 : cx + w // 2])
            elif arr.ndim == 4:  # C, Z, Y, X
                cy, cx = shape[2] // 2, shape[3] // 2
                h = min(512, shape[2])
                w = min(512, shape[3])
                d = np.array(arr[:, 0, cy - h // 2 : cy + h // 2, cx - w // 2 : cx + w // 2])
            else:
                d = np.array(arr)
            all_data.append(d)
        data = np.concatenate(all_data, axis=-1)

        updated = []
        for i, ch in enumerate(channels):
            ch = dict(ch)
            window = dict(ch.get("window", {}))
            if i < data.shape[0] and window.get("end", 0) >= 65535:
                ch_data = data[i]
                p1 = float(np.percentile(ch_data, 1))
                p999 = float(np.percentile(ch_data, 99.9))
                data_min = float(ch_data.min())
                data_max = float(ch_data.max())
                window["start"] = p1
                window["end"] = p999
                window["min"] = data_min
                window["max"] = data_max
                ch["window"] = window
            updated.append(ch)

        logging.getLogger("ndea").info("Auto-contrast from FOV %s: %s", fov_path, [
            f"ch{i}: [{c.get('window', {}).get('start', 0):.0f}, {c.get('window', {}).get('end', 0):.0f}]"
            for i, c in enumerate(updated)
        ])
    except Exception:  # noqa: BLE001
        logging.getLogger("ndea").warning("Auto-contrast sampling failed", exc_info=True)
        return channels
    else:
        return updated


def _read_plate_metadata(plate_path: str | pathlib.Path | None) -> dict[str, Any] | None:
    """Read pixel scale, shape, and channel info from an OME-Zarr plate."""
    if plate_path is None:
        return None
    try:
        from nd_embedding_atlas.ndimg._metadata import detect_ome_version, get_plate_metadata

        meta = get_plate_metadata(plate_path)
    except Exception:  # noqa: BLE001
        import logging

        logging.getLogger("ndea").warning("Failed to read plate metadata from %s", plate_path, exc_info=True)
        return None

    result: dict[str, Any] = {}
    if "pixel_scale" in meta:
        result["plate_pixel_scale"] = meta["pixel_scale"]
    if "scale" in meta:
        result["plate_scale"] = meta["scale"]
    if "shape" in meta:
        result["plate_shape"] = meta["shape"]
    if meta.get("channels"):
        channels = meta["channels"]
        # Auto-contrast: if all windows are 0-65535 (bad OME default), sample a FOV
        needs_autocontrast = any(
            ch.get("window", {}).get("start", 0) == 0 and ch.get("window", {}).get("end", 0) >= 65535
            for ch in channels
        )
        if needs_autocontrast:
            channels = _autocontrast_channels(plate_path, channels)

        result["plate_channels"] = [
            {
                "label": ch.get("label", f"Channel {i}"),
                "color": ch.get("color", "FFFFFF"),
                "window": ch.get("window", {}),
            }
            for i, ch in enumerate(channels)
        ]
    result["plate_ome_version"] = detect_ome_version(plate_path)
    return result


def _populate_obsset_tables(store: EmbeddingStore, obssets: list[dict]) -> None:
    """Bulk-insert persisted ObsSets and their members into DuckDB."""
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


def _pick_default_obsm(available: list[str]) -> str | None:
    """Choose the best default embedding from *available* keys.

    Prefers umap > tsne > phate > pca.  Handles both plain keys (``X_umap``)
    and modality-prefixed keys (``rna:X_umap``).
    """
    for suffix in ("X_umap", "X_tsne", "X_phate", "X_pca"):
        for key in available:
            # Match both "X_umap" and "rna:X_umap"
            if key == suffix or key.endswith(f":{suffix}"):
                return key
    return available[0] if available else None


def _build_dataset_config(
    obs_df, store: EmbeddingStore, default_key: str | None, *, hidden_cols: set[str], **extra,
) -> DatasetConfig:
    """Build the static DatasetConfig from store state."""
    if default_key is not None and default_key in store.loaded_embeddings:
        info = store.loaded_embeddings[default_key]
        default_x = f"{info['prefix']}_0"
        default_y = f"{info['prefix']}_1"
    else:
        default_x, default_y = "x", "y"

    obs_column_names = [c for c in obs_df.columns if c != "__row_index__" and c not in hidden_cols]

    return DatasetConfig(
        obs_column_names=obs_column_names,
        embedding_props={"data": {"id": "__row_index__", "projection": {"x": default_x, "y": default_y}}},
        default_x=default_x,
        default_y=default_y,
        **extra,
    )


def _assemble_app(
    state: ViewerState,
    config: DatasetConfig,
    *,
    plate_path: str | pathlib.Path | None = None,
    plate_meta: dict[str, Any] | None = None,
    static_dir: str | pathlib.Path | None = None,
    no_static: bool = False,
    dataset_plates: dict[str, pathlib.Path] | None = None,
    dataset_channels: dict[str, list[Any]] | None = None,
) -> FastAPI:
    """Wire up routers, mounts, and lifespan into a FastAPI app."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        import anyio

        anyio.to_thread.current_default_thread_limiter().total_tokens = 32
        yield
        state.shutdown()

    app = create_cors_app()
    app.router.lifespan_context = lifespan

    def get_state() -> ViewerState:
        return state

    # Routers
    app.include_router(
        make_crop_router(
            plate_path,
            plate_meta.get("plate_channels") if plate_meta else None,
            dataset_plates=dataset_plates,
            dataset_channels=dataset_channels,
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

    # Plate mounts
    if plate_path is not None:
        app.mount("/plate", StaticFiles(directory=str(plate_path)), name="plate")

    if dataset_plates:
        first_mounted = False
        for _key, _ds_plate_path in dataset_plates.items():
            app.mount(f"/plates/{_key}", StaticFiles(directory=str(_ds_plate_path)), name=f"plate_{_key}")
            if not first_mounted and plate_path is None:
                app.mount("/plate", StaticFiles(directory=str(_ds_plate_path)), name="plate")
                first_mounted = True

    if not no_static:
        mount_frontend(app, static_dir=static_dir)

    return app


# ── App factory ───────────────────────────────────────────────────────────


def create_app(
    source: DataSource,
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
    """Create a FastAPI app from any DataSource (AnnData collection or MuData)."""
    import time as _time

    from rich.console import Console as _Console

    _con = _Console(stderr=True)
    _t0 = _time.perf_counter()

    def _lap(label: str) -> None:
        elapsed = _time.perf_counter() - _t0
        _con.print(f"  [dim][{elapsed:.2f}s][/dim] {label}")

    _con.print(f"\n[bold]create_app[/bold]: {type(source).__name__}")
    _con.print(f"  source: [cyan]{source.n_obs:,}[/cyan] obs, [cyan]{source.n_vars:,}[/cyan] vars, keys={source.keys}")

    resolved_export_dir = pathlib.Path(export_dir).resolve() if export_dir else pathlib.Path.cwd() / "exports"

    # ── Build obs (single read) ────────────────────────────────────
    obs_df = prepare_obs(source, obs_columns=obs_columns)
    _lap(f"prepare_obs — [bold]{len(obs_df):,}[/bold] rows x {len(obs_df.columns)} cols")

    spatial = detect_spatial_columns(set(obs_df.columns), columns_config=columns_config)

    # ── Build store ──────────────────────────────────────────────────
    has_plate = plate_path is not None or bool(dataset_plates)
    plate_meta = _read_plate_metadata(plate_path) if plate_path is not None else None

    # Project mode: per-dataset plate metadata
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

        _lap(f"plate metadata read — {len(dataset_plates)} plates")

        if len(dataset_channels) > 1:
            channel_counts = {k: len(v) for k, v in dataset_channels.items()}
            if len(set(channel_counts.values())) > 1:
                _con.print(f"  [yellow]plate channel counts differ: {channel_counts}[/yellow]")

        if plate_meta is None and first_plate_meta is not None:
            plate_meta = first_plate_meta

    hidden_cols = spatial.hidden if plate_path else set()
    store = EmbeddingStore(obs_df, hidden_columns=hidden_cols, duckdb_threads=duckdb_threads, pool_workers=pool_workers)
    _lap("EmbeddingStore created")

    # ── Discover + load default embedding ────────────────────────────
    available_obsm_keys = source.obsm_keys()
    _lap(f"obsm_keys discovered — {available_obsm_keys}")

    default_key = _pick_default_obsm(available_obsm_keys)
    if default_key is not None:
        coords = source.get_obsm(default_key, dtype=np.float32)
        if hasattr(coords, "compute"):
            coords = coords.compute()
        store.register_embedding(default_key, np.asarray(coords, dtype=np.float32))
        _lap(f"default embedding '{default_key}' loaded — shape {coords.shape}")

    # ── State + config ───────────────────────────────────────────────
    state = ViewerState(
        source=source,
        store=store,
        available_obsm_keys=available_obsm_keys,
        spatial=spatial,
        export_dir=resolved_export_dir,
        dataset_plates=dataset_plates,
        dataset_ome_versions=dataset_ome_versions or None,
        dataset_pixel_scales=dataset_pixel_scales or None,
        project_config_path=project_config_path,
    )

    if project_config_path:
        from nd_embedding_atlas.server._obssets_io import load_obssets, sidecar_path

        _persisted = load_obssets(sidecar_path(project_config_path))
        if _persisted:
            _populate_obsset_tables(state.store, _persisted)

    config = _build_dataset_config(
        obs_df, store, default_key,
        hidden_cols=hidden_cols,
        has_plate=has_plate,
        plate_meta=plate_meta,
        dataset_keys=list(dataset_plates.keys()) if dataset_plates else None,
        dataset_channels=dataset_channels or None,
    )

    # ── Summary ───────────────────────────────────────────────────────
    from rich.table import Table as _Table

    t = _Table(title="Server State", show_header=True, title_style="bold")
    t.add_column("", style="dim")
    t.add_column("Value")
    t.add_row("obs", f"{len(obs_df):,} rows x {len(obs_df.columns)} cols")
    t.add_row("obsm", ", ".join(available_obsm_keys) or "none")
    t.add_row("default embedding", default_key or "none")
    t.add_row("var_count", f"{source.n_vars:,}")
    t.add_row("spatial", f"fov={spatial.fov} x={spatial.x} y={spatial.y} t={spatial.t} z={spatial.z}")
    t.add_row("plate", "yes" if has_plate else "no")
    if dataset_plates:
        t.add_row("plates", f"{len(dataset_plates)} datasets")
    t.add_row("export_dir", str(resolved_export_dir))
    t.add_row("DuckDB threads", str(duckdb_threads or "auto"))
    t.add_row("static", "off" if no_static else "mounted")
    _con.print(t)
    _lap("ready")

    return _assemble_app(
        state, config,
        plate_path=plate_path,
        plate_meta=plate_meta,
        static_dir=static_dir,
        no_static=no_static,
        dataset_plates=dataset_plates,
        dataset_channels=dataset_channels or None,
    )


# ── Serve ─────────────────────────────────────────────────────────────────


def serve_app(app: FastAPI, *, host: str = "localhost", port: int = 5055) -> None:
    """Run a pre-built FastAPI app with uvicorn."""
    import uvicorn

    print(f"nd-embedding-atlas viewer: http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, access_log=True)


def serve(
    source: DataSource,
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
    """Create app + serve. Convenience for CLI entrypoints."""
    app = create_app(
        source,
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
    serve_app(app, host=host, port=port)
