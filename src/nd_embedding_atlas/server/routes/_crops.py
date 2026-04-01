"""Crop endpoint — returns a composited WebP/PNG image for a single FOV timepoint.

URL: GET /api/crop/{fov_path}?t=6&z=0&x=100.5&y=200.3&half=150&size=200&fmt=webp

Parameters
----------
fov_path
    Path within the plate store (e.g. ``"A/1/000001"``).
t
    Timepoint index.
z
    Z-slice index (default 0).
x, y
    Crop centre in image pixels (spatial_x / spatial_y from obs table).
half
    Half-size of the crop window in image pixels. Default 150.
size
    Output image size in pixels (square). Default 200.
fmt
    Output format: ``"webp"`` (default) or ``"png"``.

The endpoint reads the zarr array at resolution level 0, applies per-channel
contrast limits from the stored plate metadata, composites all channels using
additive blending, and returns the result with a 24-hour cache header.
"""

from __future__ import annotations

import io
import pathlib
from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel


class ChannelOverride(BaseModel):
    visible: bool = True
    lo: float
    hi: float
    color: str  # hex like "FF0000" — no leading #
    blend: str = "additive"  # reserved; gallery always uses additive compositing


class CropRequest(BaseModel):
    t: int = 0
    z: int = 0
    x: float = 0.0
    y: float = 0.0
    half: int = 150
    size: int = 200
    fmt: str = "webp"
    channels: list[ChannelOverride] | None = None
    dataset_key: str | None = None


def _parse_channel_defs(plate_channels: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Pre-parse a list of plate channel dicts into render-ready defs."""
    defs: list[dict[str, Any]] = []
    if not plate_channels:
        return defs
    for ch in plate_channels:
        color_hex = ch.get("color", "FFFFFF")
        r = int(color_hex[0:2], 16) / 255.0
        g = int(color_hex[2:4], 16) / 255.0
        b = int(color_hex[4:6], 16) / 255.0
        window = ch.get("window", {})
        defs.append({
            "r": r,
            "g": g,
            "b": b,
            "lo": float(window.get("start", 0)),
            "hi": float(window.get("end", 65535)),
        })
    return defs


def make_crop_router(
    plate_path: str | pathlib.Path | None,
    plate_channels: list[dict[str, Any]] | None,
    *,
    dataset_plates: dict[str, pathlib.Path] | None = None,
    dataset_channels: dict[str, list[dict[str, Any]]] | None = None,
) -> APIRouter:
    """Create the /api/crop router.

    Returns an empty router (no routes) when neither ``plate_path`` nor
    ``dataset_plates`` is configured.

    Parameters
    ----------
    plate_path
        Single-dataset plate path (legacy / single-dataset mode).
    plate_channels
        Channel definitions for the single-dataset plate.
    dataset_plates
        Per-dataset plate paths for project mode.
    dataset_channels
        Per-dataset channel definitions for project mode.
    """
    router = APIRouter()

    has_single = plate_path is not None
    has_multi = bool(dataset_plates)

    if not has_single and not has_multi:
        return router

    # Legacy single-dataset plate root (may be None in pure project mode)
    legacy_plate_root = pathlib.Path(plate_path).resolve() if plate_path is not None else None

    # Resolve all dataset plate paths upfront
    resolved_dataset_plates: dict[str, pathlib.Path] = (
        {k: v.resolve() for k, v in dataset_plates.items()} if dataset_plates else {}
    )

    # Pre-parse default channel defs from the single-dataset plate_channels
    channel_defs: list[dict[str, Any]] = _parse_channel_defs(plate_channels)

    # Pre-parse per-dataset channel defs
    parsed_dataset_channels: dict[str, list[dict[str, Any]]] = (
        {k: _parse_channel_defs(v) for k, v in dataset_channels.items()} if dataset_channels else {}
    )

    # ── Shared helpers ────────────────────────────────────────────────────────

    def _resolve_plate_root(dk: str | None) -> pathlib.Path:
        """Resolve the plate root for a given dataset_key (O(1) dict lookup)."""
        if resolved_dataset_plates and dk and dk in resolved_dataset_plates:
            return resolved_dataset_plates[dk]
        if legacy_plate_root is not None:
            return legacy_plate_root
        msg = f"No plate configured for dataset_key={dk!r}"
        raise HTTPException(status_code=404, detail=msg)

    def _resolve_channel_defs(dk: str | None) -> list[dict[str, Any]]:
        """Resolve channel defs for a given dataset_key."""
        if parsed_dataset_channels and dk and dk in parsed_dataset_channels:
            return parsed_dataset_channels[dk]
        return channel_defs

    def _open_fov(fov_path: str, plate_root: pathlib.Path):
        """Open an OME-Zarr position via iohub and return the data array (TCZYX)."""
        from iohub.ngff import open_ome_zarr

        fov_dir = plate_root / fov_path
        if not fov_dir.exists():
            raise HTTPException(status_code=404, detail=f"FOV not found: {fov_path}")
        try:
            pos = open_ome_zarr(str(fov_dir), mode="r")
            return pos.data  # TCZYX zarr array at highest resolution
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to open FOV: {exc}") from exc

    def _composite(crop: np.ndarray, defs: list[dict[str, Any]]) -> np.ndarray:
        """Composite a [C, H, W] float32 crop into an [H, W, 3] uint8 RGB image."""
        c, h, w = crop.shape
        rgb = np.zeros((h, w, 3), dtype=np.float32)

        for ci in range(c):
            ch_data = crop[ci]
            if ci < len(defs):
                lo, hi = defs[ci]["lo"], defs[ci]["hi"]
                cr, cg, cb = defs[ci]["r"], defs[ci]["g"], defs[ci]["b"]
            else:
                lo = float(np.percentile(ch_data, 1))
                hi = float(np.percentile(ch_data, 99))
                cr = cg = cb = 1.0

            span = hi - lo
            normed = np.clip((ch_data - lo) / span, 0.0, 1.0) if span > 0 else np.zeros_like(ch_data)
            rgb[:, :, 0] += normed * cr
            rgb[:, :, 1] += normed * cg
            rgb[:, :, 2] += normed * cb

        np.clip(rgb, 0.0, 1.0, out=rgb)
        return (rgb * 255).astype(np.uint8)

    def _encode(img_u8: np.ndarray, size: int, fmt: str) -> tuple[bytes, str]:
        from PIL import Image

        img = Image.fromarray(img_u8, mode="RGB")
        if img.width != size or img.height != size:
            img = img.resize((size, size), Image.LANCZOS)
        buf = io.BytesIO()
        if fmt == "webp":
            img.save(buf, format="WEBP", quality=85, method=4)
            return buf.getvalue(), "image/webp"
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue(), "image/png"

    # ── GET endpoint (startup channel defaults) ───────────────────────────────

    @router.get("/api/crop/{fov_path:path}")
    async def get_crop(
        fov_path: str,
        t: int = Query(default=0, ge=0),
        z: int = Query(default=0, ge=0),
        x: float = Query(default=0.0),
        y: float = Query(default=0.0),
        half: int = Query(default=150, ge=8, le=1024),
        size: int = Query(default=200, ge=32, le=512),
        fmt: str = Query(default="webp", pattern="^(webp|png)$"),
        dataset_key: str | None = Query(default=None),
    ) -> Response:
        """Return a composited RGB crop using startup channel defaults."""
        plate_root = _resolve_plate_root(dataset_key)
        ch_defs = _resolve_channel_defs(dataset_key)
        data = _open_fov(fov_path, plate_root)

        n_t, n_c, n_z, n_y, n_x = data.shape
        t_idx = min(t, n_t - 1)
        z_idx = min(z, n_z - 1)

        cx, cy = int(round(x)), int(round(y))
        x0, x1 = max(0, cx - half), min(n_x, cx + half)
        y0, y1 = max(0, cy - half), min(n_y, cy + half)
        if x1 <= x0 or y1 <= y0:
            raise HTTPException(status_code=422, detail="Crop window is empty")

        try:
            crop = np.asarray(data[t_idx, :n_c, z_idx, y0:y1, x0:x1], dtype=np.float32)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to read crop: {exc}") from exc

        img_u8 = _composite(crop, ch_defs)
        content, media_type = _encode(img_u8, size, fmt)

        return Response(
            content=content,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=86400, immutable"},
        )

    # ── POST endpoint (live channel state from viewer) ────────────────────────

    @router.post("/api/crop/{fov_path:path}")
    async def post_crop_image(
        fov_path: str,
        body: CropRequest,
    ) -> Response:
        """Return a composited crop using per-request channel config from the viewer."""
        plate_root = _resolve_plate_root(body.dataset_key)
        ch_defs = _resolve_channel_defs(body.dataset_key)
        data = _open_fov(fov_path, plate_root)

        n_t, n_c, n_z, n_y, n_x = data.shape
        t_idx = min(body.t, n_t - 1)
        z_idx = min(body.z, n_z - 1)

        cx, cy = int(round(body.x)), int(round(body.y))
        x0, x1 = max(0, cx - body.half), min(n_x, cx + body.half)
        y0, y1 = max(0, cy - body.half), min(n_y, cy + body.half)
        if x1 <= x0 or y1 <= y0:
            raise HTTPException(status_code=422, detail="Crop window is empty")

        try:
            crop = np.asarray(data[t_idx, :n_c, z_idx, y0:y1, x0:x1], dtype=np.float32)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to read crop: {exc}") from exc

        # Build per-channel render defs from request body, falling back to startup defaults
        req = body.channels or []
        render_defs: list[dict[str, Any]] = []
        for ci in range(crop.shape[0]):
            if ci < len(req):
                ch = req[ci]
                if not ch.visible:
                    render_defs.append({"skip": True})
                    continue
                hex_col = ch.color.lstrip("#")
                render_defs.append({
                    "lo": ch.lo, "hi": ch.hi,
                    "r": int(hex_col[0:2], 16) / 255.0,
                    "g": int(hex_col[2:4], 16) / 255.0,
                    "b": int(hex_col[4:6], 16) / 255.0,
                })
            elif ci < len(ch_defs):
                render_defs.append(ch_defs[ci])
            else:
                ch_data = crop[ci]
                lo = float(np.percentile(ch_data, 1))
                hi = float(np.percentile(ch_data, 99))
                render_defs.append({"lo": lo, "hi": hi, "r": 1.0, "g": 1.0, "b": 1.0})

        # Composite respecting visibility (skip flag)
        h, w = crop.shape[1], crop.shape[2]
        rgb = np.zeros((h, w, 3), dtype=np.float32)
        for ci, rd in enumerate(render_defs):
            if rd.get("skip"):
                continue
            ch_data = crop[ci]
            span = rd["hi"] - rd["lo"]
            normed = np.clip((ch_data - rd["lo"]) / span, 0.0, 1.0) if span > 0 else np.zeros_like(ch_data)
            rgb[:, :, 0] += normed * rd["r"]
            rgb[:, :, 1] += normed * rd["g"]
            rgb[:, :, 2] += normed * rd["b"]

        np.clip(rgb, 0.0, 1.0, out=rgb)
        img_u8 = (rgb * 255).astype(np.uint8)
        content, media_type = _encode(img_u8, body.size, body.fmt)

        # POST responses are not HTTP-cached; React Query handles client-side caching.
        return Response(content=content, media_type=media_type)

    return router
