"""OME-Zarr metadata extraction using iohub."""

from __future__ import annotations

import json
import pathlib
from typing import Any

import pandas as pd


def get_plate_metadata(plate_path: str | pathlib.Path) -> dict[str, Any]:
    """Extract positions, channels, and scales from an OME-Zarr plate or position.

    Uses iohub for robust OME-NGFF v0.4/v0.5 metadata handling.

    Parameters
    ----------
    plate_path
        Path to an OME-Zarr store (plate or single position).

    Returns
    -------
    dict with keys:
        - ``type``: ``"plate"`` or ``"position"``
        - ``positions``: list of position keys (e.g. ``["A/1/0", "B/2/0"]``)
        - ``channels``: list of channel dicts with ``label``, ``color``, ``window``
        - ``shape``: data shape of the first position ``(T, C, Z, Y, X)``
        - ``scale``: voxel scale in micrometers
        - ``pixel_scale``: ``{"y": ..., "x": ...}`` in micrometers
    """
    from iohub.ngff import open_ome_zarr

    dataset = open_ome_zarr(str(plate_path), mode="r")

    result: dict[str, Any] = {}

    # Determine type and enumerate positions
    if hasattr(dataset, "positions"):
        result["type"] = "plate"
        positions_list = list(dataset.positions())
        result["positions"] = [key for key, _ in positions_list]
        # Use first position for channel/shape info
        _, first_pos = positions_list[0]
    else:
        result["type"] = "position"
        result["positions"] = ["/"]
        first_pos = dataset

    # Shape and scale
    result["shape"] = list(first_pos.data.shape)
    result["scale"] = list(first_pos.scale)

    # Channel names
    channel_names = list(first_pos.channel_names)
    result["channel_names"] = channel_names

    # Pixel scale (Y, X from the last 2 spatial dims)
    scale = first_pos.scale
    if len(scale) >= 2:
        result["pixel_scale"] = {"y": scale[-2], "x": scale[-1]}

    # Channel metadata from OME/OMERO (colors, windows)
    result["channels"] = _read_omero_channels(plate_path, first_pos)

    return result


def _read_omero_channels(
    plate_path: str | pathlib.Path,
    position: Any,
) -> list[dict[str, Any]]:
    """Read OMERO channel metadata (colors, contrast windows).

    Falls back to channel names with default colors if OMERO metadata is absent.
    """
    channel_names = list(position.channel_names)

    # Try reading from zarr.json (Zarr v3) or .zattrs (Zarr v2)
    store = position.zgroup.store
    pos_root = pathlib.Path(str(store.root))

    omero_channels = _try_read_omero(pos_root)
    if omero_channels and len(omero_channels) == len(channel_names):
        return [
            {
                "label": ch.get("label", channel_names[i]),
                "color": ch.get("color", "FFFFFF"),
                "window": ch.get("window", {}),
            }
            for i, ch in enumerate(omero_channels)
        ]

    # Fallback: just channel names
    return [{"label": name, "color": "FFFFFF", "window": {}} for name in channel_names]


def get_fov_dataframe(plate_path: str | pathlib.Path) -> pd.DataFrame:
    """Build a DataFrame with one row per FOV position.

    Columns: ``__row_index__``, ``position``, ``T``, ``C``, ``Z``, ``Y``, ``X``,
    ``z_um``, ``y_um``, ``x_um``.

    Parameters
    ----------
    plate_path
        Path to an OME-Zarr store (plate or single position).

    Returns
    -------
    DataFrame suitable for loading into DuckDB as the obs table.
    """
    from iohub.ngff import open_ome_zarr

    dataset = open_ome_zarr(str(plate_path), mode="r")

    rows: list[dict[str, Any]] = []

    if hasattr(dataset, "positions"):
        for idx, (key, pos) in enumerate(dataset.positions()):
            rows.append(_position_row(idx, key, pos))
    else:
        rows.append(_position_row(0, "/", dataset))

    return pd.DataFrame(rows)


def _position_row(idx: int, key: str, pos: Any) -> dict[str, Any]:
    """Extract a single row of FOV metadata from an iohub Position."""
    shape = list(pos.data.shape)
    scale = list(pos.scale)

    # Shape: always TCZYX (5D)
    t = shape[0] if len(shape) >= 5 else 1
    c = shape[1] if len(shape) >= 5 else (shape[0] if len(shape) == 4 else 1)
    z = shape[-3] if len(shape) >= 3 else 1
    y = shape[-2] if len(shape) >= 2 else shape[-1]
    x = shape[-1]

    # Scale: last 3 are Z, Y, X in micrometers
    z_um = scale[-3] if len(scale) >= 3 else 1.0
    y_um = scale[-2] if len(scale) >= 2 else 1.0
    x_um = scale[-1] if len(scale) >= 1 else 1.0

    return {
        "__row_index__": idx,
        "position": key,
        "T": t,
        "C": c,
        "Z": z,
        "Y": y,
        "X": x,
        "z_um": round(z_um, 4),
        "y_um": round(y_um, 4),
        "x_um": round(x_um, 4),
    }


def _try_read_omero(pos_path: pathlib.Path) -> list[dict] | None:
    """Try to read OMERO channel metadata from zarr.json or .zattrs."""
    # Zarr v3: zarr.json
    zarr_json = pos_path / "zarr.json"
    if zarr_json.exists():
        try:
            attrs = json.loads(zarr_json.read_text()).get("attributes", {})
            return attrs.get("ome", {}).get("omero", {}).get("channels")
        except (json.JSONDecodeError, KeyError):
            pass

    # Zarr v2: .zattrs
    zattrs = pos_path / ".zattrs"
    if zattrs.exists():
        try:
            attrs = json.loads(zattrs.read_text())
            return attrs.get("omero", {}).get("channels")
        except (json.JSONDecodeError, KeyError):
            pass

    return None
