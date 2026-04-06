"""Binary scatter data endpoints for the WebGPU scatter renderer."""

import asyncio
import json
import struct
from collections.abc import Callable
from typing import TYPE_CHECKING, Annotated

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from nd_embedding_atlas.server._state import ViewerState


class _SelectionBody(BaseModel):
    row_indices: list[int]


if TYPE_CHECKING:
    pass

# ── Binary format helpers ──────────────────────────────────────────────────────
# Format (version 1):
#   [1 byte]           version = 1  (uint8)
#   [4 bytes]          header_len   (uint32 LE)
#   [header_len bytes] JSON header  (UTF-8)
#   [0-3 bytes]        zero padding to align to 4-byte boundary
#   [data bytes]       the actual typed array data


def _pack_binary(header: dict, data: np.ndarray) -> bytes:
    """Encode a JSON header + numpy array payload into the v1 binary format.

    Parameters
    ----------
    header
        JSON-serialisable dict describing the payload.
    data
        Numpy array whose ``tobytes()`` forms the payload.

    Returns
    -------
    bytes
        Version-tagged binary blob.
    """
    version = struct.pack("B", 1)
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    header_len = struct.pack("<I", len(header_bytes))
    # Pad header so that data starts on a 4-byte boundary.
    # Total prefix = 1 (version) + 4 (header_len) + len(header_bytes)
    prefix_len = 1 + 4 + len(header_bytes)
    padding = b"\x00" * ((-prefix_len) % 4)
    return version + header_len + header_bytes + padding + data.tobytes()


# ── Router factory ─────────────────────────────────────────────────────────────


def make_scatter_router(get_state: Callable[[], ViewerState]) -> APIRouter:
    """Return an APIRouter for binary scatter data endpoints.

    Parameters
    ----------
    get_state
        Callable that returns the current :class:`ViewerState`.

    Returns
    -------
    APIRouter
        Router with ``/api/scatter-positions``, ``/api/scatter-categories``,
        and ``/api/scatter-continuous-colors`` endpoints.
    """
    router = APIRouter()
    State = Annotated[ViewerState, Depends(get_state)]

    # ── /api/scatter-positions ─────────────────────────────────────────────────

    @router.get("/api/scatter-positions")
    async def get_scatter_positions(
        state: State,
        embedding: str,
        x_col: str,
        y_col: str,
    ) -> Response:
        """Return float32 interleaved x/y positions normalised to [-1, 1].

        Parameters
        ----------
        embedding
            The obsm key (e.g. ``"X_umap"``).
        x_col
            DuckDB column name for the x coordinate (e.g. ``"x_umap_0"``).
        y_col
            DuckDB column name for the y coordinate (e.g. ``"x_umap_1"``).
        """

        def _build() -> bytes:
            with state.store.cursor() as cur:
                try:
                    rows = cur.execute(
                        f'SELECT __row_index__, "{x_col}", "{y_col}" FROM dataset ORDER BY __row_index__ ASC'
                    ).fetchall()
                except Exception as exc:
                    msg = f"Failed to query columns '{x_col}', '{y_col}': {exc}"
                    raise ValueError(msg) from exc

            n = len(rows)
            row_indices = [r[0] for r in rows]
            xs = np.array([r[1] for r in rows], dtype=np.float64)
            ys = np.array([r[2] for r in rows], dtype=np.float64)

            # Replace NaN/Inf with 0 before normalisation
            xs = np.where(np.isfinite(xs), xs, 0.0)
            ys = np.where(np.isfinite(ys), ys, 0.0)

            # Normalise to [-1, 1]
            max_abs = max(np.abs(xs).max() if n else 0.0, np.abs(ys).max() if n else 0.0)
            if max_abs > 0:
                xs = xs / max_abs
                ys = ys / max_abs

            # Interleave x0,y0,x1,y1,...
            interleaved = np.empty(n * 2, dtype=np.float32)
            interleaved[0::2] = xs.astype(np.float32)
            interleaved[1::2] = ys.astype(np.float32)

            header = {
                "numCells": n,
                "embeddingKey": embedding,
                "ndim": 2,
                "rowIndices": row_indices,
                "positionScale": float(max_abs) if max_abs > 0 else 1.0,
            }
            return _pack_binary(header, interleaved)

        try:
            payload = await asyncio.get_running_loop().run_in_executor(state.executor, _build)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return Response(payload, media_type="application/octet-stream")

    # ── /api/scatter-categories ────────────────────────────────────────────────

    @router.get("/api/scatter-categories")
    async def get_scatter_categories(
        state: State,
        cat_col: str,
        original_col: str | None = None,
    ) -> Response:
        """Return uint8 category indices, one per observation.

        Parameters
        ----------
        cat_col
            Integer category-index column in DuckDB (e.g. ``"__ev_cell_type_id"``).
        original_col
            If provided, the original string column used to look up human-readable
            category names (e.g. ``"cell_type"``).
        """

        def _build() -> bytes:
            with state.store.cursor() as cur:
                # Fetch category indices ordered by row
                try:
                    idx_rows = cur.execute(f'SELECT "{cat_col}" FROM obs_base ORDER BY __row_index__ ASC').fetchall()
                except Exception as exc:
                    msg = f"Failed to query category column '{cat_col}': {exc}"
                    raise ValueError(msg) from exc

                # Build category name list
                if original_col is not None:
                    try:
                        name_rows = cur.execute(
                            f'SELECT DISTINCT "{original_col}" FROM obs_base ORDER BY "{original_col}" ASC'
                        ).fetchall()
                        category_names = [str(r[0]) for r in name_rows]
                    except Exception:  # noqa: BLE001
                        category_names = []
                else:
                    # Derive names from the sorted unique integer ids
                    try:
                        id_rows = cur.execute(
                            f'SELECT DISTINCT "{cat_col}" FROM obs_base ORDER BY "{cat_col}" ASC'
                        ).fetchall()
                        category_names = [str(r[0]) for r in id_rows]
                    except Exception:  # noqa: BLE001
                        category_names = []

            indices = np.array([r[0] if r[0] is not None else 0 for r in idx_rows], dtype=np.uint8)
            header = {"categoryNames": category_names}
            return _pack_binary(header, indices)

        try:
            payload = await asyncio.get_running_loop().run_in_executor(state.executor, _build)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return Response(payload, media_type="application/octet-stream")

    # ── /api/scatter-continuous-colors ────────────────────────────────────────

    @router.get("/api/scatter-continuous-colors")
    async def get_scatter_continuous_colors(
        state: State,
        color_col: str,
        colormap: str = "viridis",
        vmin: float | None = None,
        vmax: float | None = None,
    ) -> Response:
        """Return float32 RGBA per observation, pre-mapped through a colormap.

        Parameters
        ----------
        color_col
            Numeric column in DuckDB to use for coloring.
        colormap
            Colormap name (default ``"viridis"``).
        vmin
            Lower clamp value.  Defaults to the column minimum.
        vmax
            Upper clamp value.  Defaults to the column maximum.
        """
        from nd_embedding_atlas.io._colors import sample_continuous_colormap

        def _build() -> bytes:
            with state.store.cursor() as cur:
                try:
                    rows = cur.execute(f'SELECT "{color_col}" FROM obs_base ORDER BY __row_index__ ASC').fetchall()
                except Exception as exc:
                    msg = f"Failed to query color column '{color_col}': {exc}"
                    raise ValueError(msg) from exc

            values = np.array([r[0] if r[0] is not None else float("nan") for r in rows], dtype=np.float64)

            # Determine vmin/vmax from data when not provided
            finite = values[np.isfinite(values)]
            actual_vmin = float(vmin) if vmin is not None else (float(finite.min()) if len(finite) else 0.0)
            actual_vmax = float(vmax) if vmax is not None else (float(finite.max()) if len(finite) else 1.0)

            # Normalise to [0, 1]; NaN → 0.5
            span = actual_vmax - actual_vmin
            if span > 0:
                normalised = (values - actual_vmin) / span
            else:
                normalised = np.full_like(values, 0.5)
            normalised = np.where(np.isfinite(normalised), normalised, 0.5)
            normalised = np.clip(normalised, 0.0, 1.0)

            # Map through colormap → uint8 RGB (N, 3)
            rgb = sample_continuous_colormap(colormap, normalised)

            # Build uint8 RGBA (N, 4) with alpha = 255.
            # 4x smaller than float32 RGBA — frontend does zero-copy Uint32Array reinterpret.
            n = len(values)
            rgba_u8 = np.empty((n, 4), dtype=np.uint8)
            rgba_u8[:, :3] = rgb
            rgba_u8[:, 3] = 255

            header = {
                "numPoints": n,
                "vmin": actual_vmin,
                "vmax": actual_vmax,
                "colormap": colormap,
            }
            return _pack_binary(header, rgba_u8)

        try:
            payload = await asyncio.get_running_loop().run_in_executor(state.executor, _build)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return Response(payload, media_type="application/octet-stream")

    # ── Selection temp table ────────────────────────────────────────────────────
    # For large lasso selections (≥ 5000 pts) the frontend posts selected row
    # indices here.  We write them into a DuckDB temp table so the Mosaic
    # table-panel query can use a subquery predicate instead of a massive OR chain:
    #   WHERE __row_index__ IN (SELECT row_index FROM __scatter_selection)
    # DuckDB evaluates this as a hash join — O(1) vs O(n) OR clauses.

    @router.post("/api/scatter-selection")
    async def update_scatter_selection(body: _SelectionBody, state: State) -> dict:
        """Write selected row indices into the __scatter_selection temp table."""
        import pyarrow as pa

        def _write(row_indices: list[int]) -> None:
            arr = pa.array(row_indices, type=pa.uint32())
            tbl = pa.table({"row_index": arr})  # noqa: F841 — DuckDB reads local PyArrow vars
            state.store.con.execute("DROP TABLE IF EXISTS __scatter_selection")
            state.store.con.execute("CREATE TEMP TABLE __scatter_selection AS SELECT * FROM tbl")

        await asyncio.get_running_loop().run_in_executor(state.executor, _write, body.row_indices)
        return {"ok": True, "count": len(body.row_indices)}

    @router.delete("/api/scatter-selection")
    async def clear_scatter_selection(state: State) -> dict:
        """Remove the __scatter_selection temp table (clears the table filter)."""

        def _clear() -> None:
            state.store.con.execute("DROP TABLE IF EXISTS __scatter_selection")

        await asyncio.get_running_loop().run_in_executor(state.executor, _clear)
        return {"ok": True}

    return router
