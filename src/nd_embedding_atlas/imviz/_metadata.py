"""OME-Zarr metadata extraction using iohub."""

from __future__ import annotations

import json
import pathlib
from typing import Any


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
