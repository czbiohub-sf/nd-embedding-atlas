"""FastAPI app for serving OME-Zarr images with idetik frontend.

Serves the nd-embedding-atlas frontend with shim endpoints so that
the dashboard boots, shows the image-viewer panel, and auto-loads the
first FOV.  Embedding scatter / DuckDB / Mosaic are replaced by minimal
stubs that return enough data for the frontend to render.
"""

from __future__ import annotations

import importlib.metadata
import importlib.resources
import io
import pathlib

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from nd_embedding_atlas.imviz._metadata import get_plate_metadata


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


def _build_shim_parquet(n_positions: int) -> bytes:
    """Build a minimal Parquet file with one row per position.

    The frontend (Mosaic + embedding-atlas scatter) expects a dataset.parquet
    with at least an ``__row_index__`` column and x/y projection columns.
    We create one row per position so that each can be "selected" via the
    ``/api/cell/{row_index}`` endpoint.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    table = pa.table(
        {
            "__row_index__": pa.array(list(range(n_positions)), type=pa.int64()),
            "x": pa.array([float(i) for i in range(n_positions)], type=pa.float32()),
            "y": pa.array([0.0] * n_positions, type=pa.float32()),
        }
    )
    buf = pa.BufferOutputStream()
    pq.write_table(table, buf)
    return buf.getvalue().to_pybytes()


def create_app(
    plate_path: str | pathlib.Path,
    *,
    position: str | None = None,
    channels: list[str] | None = None,
    static_dir: str | pathlib.Path | None = None,
) -> FastAPI:
    """Create a FastAPI app for viewing OME-Zarr images.

    Serves the nd-embedding-atlas frontend with all required endpoints
    shimmed so the image viewer panel works out of the box.

    Parameters
    ----------
    plate_path
        Path to an OME-Zarr plate or position directory.
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
    plate_path = pathlib.Path(plate_path).resolve()
    app = FastAPI(title="imviz")
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    # ── Pre-compute metadata ─────────────────────────────────────────
    meta = get_plate_metadata(plate_path)

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

    n_positions = len(positions_list)

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

    # Pre-build parquet bytes (small — one row per position)
    parquet_bytes = _build_shim_parquet(n_positions)

    # ── /data/metadata.json — the frontend's primary config endpoint ──
    try:
        version = importlib.metadata.version("nd-embedding-atlas")
    except importlib.metadata.PackageNotFoundError:
        version = "0.0.0-dev"

    @app.get("/data/metadata.json")
    async def get_metadata() -> dict:
        return {
            "version": version,
            "props": {
                "data": {
                    "id": "__row_index__",
                    "projection": {"x": "x", "y": "y"},
                },
            },
            "database": {"type": "rest"},
            "obsm": {},
            "obs_columns": [],
            "plate": True,
            "plate_pixel_scale": pixel_scale,
            "plate_channels": plate_channels,
            "spatial": {
                "fov_col": "fov_name",
                "t_col": None,
                "bbox_col": None,
                "x_col": None,
                "y_col": None,
            },
        }

    # ── /data/dataset.parquet — Mosaic needs this to boot ─────────────
    @app.get("/data/dataset.parquet")
    async def get_parquet() -> Response:
        return Response(parquet_bytes, media_type="application/octet-stream")

    # ── /data/query — Mosaic REST connector stub ──────────────────────
    # The Mosaic coordinator sends SQL queries here.  We use an in-memory
    # DuckDB to answer them from the shim parquet.
    import duckdb
    import pyarrow.parquet as pq

    _con = duckdb.connect()
    _shim_table = pq.read_table(io.BytesIO(parquet_bytes))
    _con.execute("CREATE TABLE dataset AS SELECT * FROM _shim_table")

    @app.post("/data/query")
    async def mosaic_query(request: Request) -> Response:
        body = await request.json()
        sql = body.get("sql", "")
        if not sql:
            return JSONResponse({"error": "no sql"}, status_code=400)
        try:
            result = _con.execute(sql)
            # Return Apache Arrow IPC format (what mosaic-rest expects)
            import pyarrow as pa

            table = result.arrow()
            sink = pa.BufferOutputStream()
            writer = pa.ipc.new_stream(sink, table.schema)
            writer.write_table(table)
            writer.close()
            return Response(
                sink.getvalue().to_pybytes(),
                media_type="application/vnd.apache.arrow.stream",
            )
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    # ── /api/cell/{row_index} — map row index to FOV info ─────────────
    @app.get("/api/cell/{row_index}", response_model=None)
    async def get_cell(row_index: int) -> dict | JSONResponse:
        if row_index < 0 or row_index >= n_positions:
            return JSONResponse({"error": "Position not found"}, status_code=404)

        fov_name = positions_list[row_index]
        # For a single position, fov_name is "/" — serve from plate root
        if fov_name == "/":
            fov_name = ""

        return {
            "fov_name": fov_name,
            "t": 0,
            "x": meta["shape"][-1] / 2,  # Center X
            "y": meta["shape"][-2] / 2,  # Center Y
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
        return {"status": "ok", "plate": str(plate_path), "type": meta["type"]}

    # ── Static file mounts (order matters — most specific first) ──────
    # Serve OME-Zarr data
    app.mount("/plate", StaticFiles(directory=str(plate_path)), name="plate")

    # Serve frontend with auto-select injection
    if static_dir is not None:
        resolved_static = str(static_dir)
    else:
        resolved_static = _resolve_frontend()

    _frontend_dir = pathlib.Path(resolved_static)
    _index_html = (_frontend_dir / "index.html").read_text()

    # Inject a script that auto-clicks cell 0 after the React app mounts.
    # The DashboardProvider stores its actions on window.__NDEA_ACTIONS__
    # which doesn't exist, so instead we poll for a clickable scatter point
    # and simulate a click, OR we directly poke React's internal state via
    # a MutationObserver that waits for the scatter canvas and dispatches
    # a synthetic selection.
    #
    # Simplest robust approach: poll for the "Click a cell" text in the
    # image viewer panel and programmatically trigger highlight via the
    # embedding-atlas scatter's built-in tooltip/selection API.
    #
    # Even simpler: just inject the highlightId into the DashboardProvider's
    # initial state by intercepting the metadata response.  But that's not
    # how React works externally.
    #
    # Most reliable: inject a tiny inline script that, after the app boots,
    # finds React's fiber tree and calls setHighlight("0").
    _auto_select_script = """
<script>
// imviz: auto-select cell 0 so the image viewer loads immediately.
// We poll for the React root's __reactFiber and walk to DashboardContext
// to call setHighlight("0").
(function() {
  var attempts = 0;
  var timer = setInterval(function() {
    attempts++;
    if (attempts > 100) { clearInterval(timer); return; }
    // Look for the "Click a cell to view" text — if present, the app
    // has mounted but no cell is selected yet.
    var el = document.querySelector('[class*="text-text-muted"]');
    if (!el) return;
    // Find the React internal instance on the root element
    var root = document.getElementById('root');
    if (!root) return;
    var key = Object.keys(root).find(function(k) {
      return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$');
    });
    if (!key) return;
    // Walk the fiber tree to find DashboardContext consumer
    function findContext(fiber, depth) {
      if (!fiber || depth > 50) return null;
      // Check memoizedState for the dashboard actions
      if (fiber.memoizedProps && fiber.memoizedProps.value &&
          fiber.memoizedProps.value.actions &&
          fiber.memoizedProps.value.actions.setHighlight) {
        return fiber.memoizedProps.value.actions;
      }
      var result = findContext(fiber.child, depth + 1);
      if (result) return result;
      return findContext(fiber.sibling, depth + 1);
    }
    var actions = findContext(root[key], 0);
    if (actions) {
      actions.setHighlight("0");
      clearInterval(timer);
    }
  }, 200);
})();
</script>
"""
    _patched_index = _index_html.replace("</body>", _auto_select_script + "</body>")

    from starlette.responses import HTMLResponse

    @app.get("/", response_class=HTMLResponse)
    async def index_page() -> str:
        return _patched_index

    app.mount("/", StaticFiles(directory=resolved_static, html=False))

    return app


def serve(
    plate_path: str | pathlib.Path,
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
    plate_path
        Path to an OME-Zarr plate or position.
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
        plate_path,
        position=position,
        channels=channels,
        static_dir=static_dir,
    )
    print(f"imviz viewer: http://{host}:{port}")
    print(f"  plate: {plate_path}")
    uvicorn.run(app, host=host, port=port, access_log=False)
