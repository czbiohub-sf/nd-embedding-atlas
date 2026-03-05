"""Shared FastAPI server helpers used by both ``vz`` and ``ndimg``."""

from __future__ import annotations

import importlib.metadata
import importlib.resources
import pathlib

import pyarrow as pa
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles


def resolve_frontend() -> str:
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


def create_cors_app(*, title: str = "nd-embedding-atlas") -> FastAPI:
    """Create a FastAPI app with standard CORS middleware."""
    app = FastAPI(title=title)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
    return app


def mount_frontend(app: FastAPI, *, static_dir: str | pathlib.Path | None = None) -> None:
    """Mount the React frontend as a catch-all static file handler.

    Must be called **after** all other mounts (plate, API routes) since
    ``html=True`` makes it a catch-all for SPA routing.
    """
    resolved = str(static_dir) if static_dir else resolve_frontend()
    app.mount("/", StaticFiles(directory=resolved, html=True))


def get_package_version() -> str:
    """Get the package version, falling back to ``0.0.0-dev`` in editable installs."""
    try:
        return importlib.metadata.version("nd-embedding-atlas")
    except importlib.metadata.PackageNotFoundError:
        return "0.0.0-dev"


def arrow_to_ipc_bytes(arrow: pa.Table | pa.RecordBatchReader) -> bytes:
    """Serialize an Arrow Table or RecordBatchReader to IPC stream bytes.

    Handles both ``pa.Table`` (DuckDB < 1.4) and ``pa.RecordBatchReader``
    (DuckDB >= 1.4) transparently.
    """
    sink = pa.BufferOutputStream()
    if isinstance(arrow, pa.Table):
        with pa.ipc.new_stream(sink, arrow.schema) as writer:
            writer.write(arrow)
    else:
        with pa.ipc.new_stream(sink, arrow.schema) as writer:
            for batch in arrow:
                writer.write_batch(batch)
    return sink.getvalue().to_pybytes()


def build_parquet_bytes(con: object) -> bytes:
    """Build Parquet bytes from the ``dataset`` VIEW. Handles DuckDB >= 1.4 RecordBatchReader.

    Parameters
    ----------
    con
        A DuckDB connection or cursor with a ``dataset`` VIEW.
    """
    import pyarrow.parquet as pq

    arrow = con.sql("SELECT * FROM dataset").arrow()  # type: ignore[union-attr]
    sink = pa.BufferOutputStream()
    if isinstance(arrow, pa.Table):
        pq.write_table(arrow, sink)
    else:
        # DuckDB >= 1.4 returns RecordBatchReader
        table = pa.Table.from_batches(list(arrow), schema=arrow.schema)
        pq.write_table(table, sink)
    return sink.getvalue().to_pybytes()
