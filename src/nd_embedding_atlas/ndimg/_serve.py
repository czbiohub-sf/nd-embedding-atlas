"""FastAPI app for serving OME-Zarr images with idetik frontend.

Serves the nd-embedding-atlas frontend with a FOV table backed by DuckDB.
The dashboard shows a table of positions; clicking a row loads the
corresponding FOV via idetik.  Mosaic query endpoints are provided by
``vz._duckdb.mount_duckdb_endpoints``.
"""

from __future__ import annotations

import importlib.metadata
import importlib.resources
import pathlib

import duckdb
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from nd_embedding_atlas.ndimg._metadata import (
    detect_ome_version,
    get_multi_store_fov_dataframe,
    get_plate_metadata,
)
from nd_embedding_atlas.vz._duckdb import mount_duckdb_endpoints


def _resolve_frontend() -> str:
    """Resolve the nd-embedding-atlas frontend directory.

    Resolution order:

    1. **Dev** -- walk up from this file to find ``frontend/dist/``
    2. **Bundled** -- ``importlib.resources`` for ``nd_embedding_atlas/_frontend/``
    """
    p = pathlib.Path(__file__).resolve()
    for parent in p.parents:
        dist = parent / "frontend" / "dist"
        if dist.is_dir():
            return str(dist)

    ref = importlib.resources.files("nd_embedding_atlas") / "_frontend"
    if ref.is_dir():
        return str(ref)

    msg = (
        "No frontend found. Either:\n"
        "  - Run `cd frontend && pnpm install && pnpm build` (development)\n"
        "  - Install from wheel: `uv pip install nd-embedding-atlas`"
    )
    raise FileNotFoundError(msg)


def create_app(
    plate_paths: str | pathlib.Path | list[str | pathlib.Path],
    *,
    position: str | None = None,
    channels: list[str] | None = None,
    static_dir: str | pathlib.Path | None = None,
) -> FastAPI:
    """Create a FastAPI app for viewing OME-Zarr images.

    Serves the nd-embedding-atlas frontend with a DuckDB-backed FOV table
    and idetik image viewer.

    Parameters
    ----------
    plate_paths
        Path(s) to OME-Zarr plate or position directories.  Accepts a single
        path or a list for multi-store browsing.
    position
        Initial position key to display.  ``None`` uses the first position.
    channels
        Subset of channel names to display.  ``None`` shows all channels.
    static_dir
        Frontend directory override.  ``None`` resolves automatically.

    Returns
    -------
    FastAPI app ready for ``uvicorn.run()``.
    """
    # Normalize to list of resolved Paths
    if isinstance(plate_paths, (str, pathlib.Path)):
        plate_paths = [plate_paths]
    resolved_paths = [pathlib.Path(p).resolve() for p in plate_paths]

    app = FastAPI(title="ndimg")
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    # ── Pre-compute metadata from first store ────────────────────────
    meta = get_plate_metadata(resolved_paths[0])

    # Apply channel filter
    if channels:
        available = meta["channel_names"]
        filtered_indices = [i for i, name in enumerate(available) if name in channels]
        meta["channel_names"] = [available[i] for i in filtered_indices]
        if meta["channels"]:
            meta["channels"] = [meta["channels"][i] for i in filtered_indices]

    positions_list: list[str] = meta["positions"]
    if position is None and positions_list:
        position = positions_list[0]

    # Build plate_channels in the format the frontend expects
    plate_channels = []
    for ch in meta["channels"]:
        window = ch.get("window", {})
        plate_channels.append(
            {
                "label": ch.get("label", ""),
                "color": ch.get("color", "FFFFFF"),
                "window": {
                    "start": window.get("start", 0),
                    "end": window.get("end", 65535),
                    "min": window.get("min", 0),
                    "max": window.get("max", 65535),
                },
            }
        )

    pixel_scale = meta.get("pixel_scale", {"x": 1, "y": 1})

    # ── Build per-store info ─────────────────────────────────────────
    plate_stores = [
        {
            "mount": f"/plate_{i}",
            "name": p.stem,
            "ome_version": detect_ome_version(p),
        }
        for i, p in enumerate(resolved_paths)
    ]

    # ── Build FOV table in DuckDB ────────────────────────────────────
    fov_df = get_multi_store_fov_dataframe(resolved_paths)  # noqa: F841 — DuckDB scans local Python variables by name
    con = duckdb.connect(":memory:")
    con.sql("CREATE TABLE obs_base AS (SELECT * FROM fov_df)")
    con.sql("CREATE OR REPLACE VIEW dataset AS SELECT * FROM obs_base")

    # Mount Mosaic query endpoints (reuse vz infrastructure)
    mount_duckdb_endpoints(app, con)

    # ── Parquet cache ────────────────────────────────────────────────
    parquet_cache: dict[str, bytes | None] = {"data": None}

    # ── /data/metadata.json — the frontend's primary config endpoint ──
    try:
        version = importlib.metadata.version("nd-embedding-atlas")
    except importlib.metadata.PackageNotFoundError:
        version = "0.0.0-dev"

    obs_column_names = ["dataset", "position", "T", "C", "Z", "Y", "X", "z_um", "y_um", "x_um", "ome_version"]

    @app.get("/data/metadata.json")
    async def get_metadata() -> dict:
        return {
            "version": version,
            "props": {
                "data": {
                    "id": "__row_index__",
                    "projection": {"x": "X", "y": "Y"},
                },
            },
            "database": {"type": "rest"},
            "obsm": {},
            "obs_columns": obs_column_names,
            "plate": True,
            "plate_pixel_scale": pixel_scale,
            "plate_channels": plate_channels,
            "plate_stores": plate_stores,
            "spatial": {
                "fov_col": "position",
                "t_col": None,
                "bbox_col": None,
                "x_col": None,
                "y_col": None,
            },
        }

    # ── /data/dataset.parquet — Mosaic needs this to boot ─────────────
    @app.get("/data/dataset.parquet")
    async def get_parquet() -> Response:
        if parquet_cache["data"] is None:
            import pyarrow as pa
            import pyarrow.parquet as pq

            arrow = con.sql("SELECT * FROM dataset").arrow()
            sink = pa.BufferOutputStream()
            if isinstance(arrow, pa.Table):
                pq.write_table(arrow, sink)
            else:
                # DuckDB >= 1.4 returns RecordBatchReader
                table = pa.Table.from_batches(list(arrow), schema=arrow.schema)
                pq.write_table(table, sink)
            parquet_cache["data"] = sink.getvalue().to_pybytes()
        return Response(parquet_cache["data"], media_type="application/octet-stream")

    # ── /api/cell/{row_index} — map row index to FOV info ─────────────
    shape_y = meta["shape"][-2]
    shape_x = meta["shape"][-1]

    @app.get("/api/cell/{row_index}", response_model=None)
    async def get_cell(row_index: int) -> dict | JSONResponse:
        row = con.execute(
            "SELECT position, store_index FROM dataset WHERE __row_index__ = ?",
            [row_index],
        ).fetchone()
        if row is None:
            return JSONResponse({"error": "Position not found"}, status_code=404)

        fov_name = row[0]
        store_index = row[1]
        # For a single position, fov_name is "/" — serve from plate root
        if fov_name == "/":
            fov_name = ""

        return {
            "fov_name": fov_name,
            "store_index": store_index,
            "t": 0,
            "x": shape_x / 2,
            "y": shape_y / 2,
        }

    # ── Embedding stubs (frontend polls these) ────────────────────────
    @app.post("/api/embeddings/{key}")
    async def load_embedding(key: str) -> JSONResponse:
        return JSONResponse({"error": f"Unknown obsm key: {key}"}, status_code=404)

    @app.get("/api/embeddings/{key}/status")
    async def embedding_status(key: str) -> JSONResponse:
        return JSONResponse({"status": "not_started"})

    @app.get("/api/health")
    async def health() -> dict:
        return {
            "status": "ok",
            "stores": [str(p) for p in resolved_paths],
            "type": meta["type"],
        }

    # ── Static file mounts (order matters — most specific first) ──────
    # Serve OME-Zarr data — one mount per store
    for i, p in enumerate(resolved_paths):
        app.mount(f"/plate_{i}", StaticFiles(directory=str(p)), name=f"plate_{i}")

    # Serve frontend with html=True for SPA routing
    if static_dir is not None:
        resolved_static = str(static_dir)
    else:
        resolved_static = _resolve_frontend()

    app.mount("/", StaticFiles(directory=resolved_static, html=True))

    return app


def serve(
    plate_paths: str | pathlib.Path | list[str | pathlib.Path],
    *,
    position: str | None = None,
    channels: list[str] | None = None,
    static_dir: str | pathlib.Path | None = None,
    host: str = "0.0.0.0",
    port: int = 5055,
) -> None:
    """Launch the idetik OME-Zarr viewer.

    Parameters
    ----------
    plate_paths
        Path(s) to OME-Zarr plate(s) or position(s).
    position
        Initial position to display.
    channels
        Channel names to show (``None`` = all).
    static_dir
        Frontend directory override.
    host, port
        Server bind address.
    """
    app = create_app(
        plate_paths,
        position=position,
        channels=channels,
        static_dir=static_dir,
    )
    print(f"ndimg viewer: http://{host}:{port}")
    if isinstance(plate_paths, (str, pathlib.Path)):
        plate_paths = [plate_paths]
    for p in plate_paths:
        print(f"  store: {p}")
    uvicorn.run(app, host=host, port=port, access_log=False)
