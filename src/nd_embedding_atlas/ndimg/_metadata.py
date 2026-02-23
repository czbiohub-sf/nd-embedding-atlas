"""OME-Zarr metadata extraction using iohub."""

from __future__ import annotations

import json
import pathlib
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd
import yaml


@lru_cache(maxsize=1)
def _load_channel_color_map() -> dict[str, str]:
    """Load channel color hex map from scripts/channel_colors.yaml."""
    yaml_path = pathlib.Path(__file__).resolve().parents[3] / "scripts" / "channel_colors.yaml"
    if not yaml_path.exists():
        return {"default": "FFFFFF"}
    with yaml_path.open() as f:
        return yaml.safe_load(f)


def get_default_channel_color(channel_name: str) -> str:
    """Return hex color for a channel name, using scripts/channel_colors.yaml defaults.

    Parameters
    ----------
    channel_name
        Channel label (e.g. ``"DAPI"``, ``"GFP"``).

    Returns
    -------
    str
        6-character hex color string (e.g. ``"0080FF"``).
    """
    color_map = _load_channel_color_map()
    name_lower = channel_name.lower()

    # Exact match (case-insensitive)
    for key, color in color_map.items():
        if key.lower() == name_lower:
            return color

    # Substring match
    for key, color in color_map.items():
        if key != "default" and key.lower() in name_lower:
            return color

    return color_map.get("default", "FFFFFF")


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

    # Auto-contrast: sample first position to compute intensity percentiles
    _apply_auto_contrast(first_pos, result["channels"])

    return result


def _sample_contrast_range(
    data: Any,
    channel_idx: int,
    *,
    time_point: int = 0,
    low_pct: float = 1.0,
    high_pct: float = 99.0,
    sample_fraction: float = 0.1,
) -> tuple[float, float]:
    """Calculate contrast range by sampling a fraction of voxels.

    Uses strided indexing to efficiently downsample the volume.

    Parameters
    ----------
    data
        Array-like with shape ``(T, C, Z, Y, X)`` or ``(C, Z, Y, X)``.
    channel_idx
        Channel index to sample.
    time_point
        Timepoint to sample (for 5D data).
    low_pct, high_pct
        Percentiles for contrast range.
    sample_fraction
        Fraction of voxels to sample (0.1 = 10%).

    Returns
    -------
    ``(min, max)`` intensity values at the given percentiles.
    """
    shape = data.shape

    if len(shape) == 5:  # TCZYX
        z_size, y_size, x_size = shape[2], shape[3], shape[4]
    elif len(shape) == 4:  # CZYX
        z_size, y_size, x_size = shape[1], shape[2], shape[3]
    else:
        return 0.0, 65535.0

    total_pixels = z_size * y_size * x_size
    target_pixels = int(total_pixels * sample_fraction)
    stride = max(1, int(np.cbrt(total_pixels / target_pixels)))

    if len(shape) == 5:
        t = min(time_point, shape[0] - 1)
        sample = np.array(data[t, channel_idx, ::stride, ::stride, ::stride])
    else:
        sample = np.array(data[channel_idx, ::stride, ::stride, ::stride])

    return float(np.percentile(sample, low_pct)), float(np.percentile(sample, high_pct))


def _apply_auto_contrast(position: Any, channels: list[dict[str, Any]]) -> None:
    """Update channel windows with auto-contrast from sampled data.

    Modifies *channels* in place.  Skips channels that already have
    meaningful contrast windows (start != 0 or end != 65535).
    """
    data = position.data
    n_channels = len(channels)

    for i in range(n_channels):
        window = channels[i].get("window", {})
        start = window.get("start", 0)
        end = window.get("end", 65535)

        # Skip if window already looks reasonable (not full 16-bit range)
        if start != 0 or end != 65535:
            continue

        try:
            lo, hi = _sample_contrast_range(data, i)
            channels[i]["window"] = {
                "start": round(lo, 1),
                "end": round(hi, 1),
                "min": round(lo, 1),
                "max": round(hi, 1),
            }
        except Exception:  # noqa: BLE001
            pass  # Keep default window on error


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
                "color": ch.get("color") or get_default_channel_color(ch.get("label", channel_names[i])),
                "window": ch.get("window", {}),
            }
            for i, ch in enumerate(omero_channels)
        ]

    # Fallback: channel names with default colors from channel_colors.yaml
    return [{"label": name, "color": get_default_channel_color(name), "window": {}} for name in channel_names]


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


def detect_ome_version(plate_path: str | pathlib.Path) -> str:
    """Detect OME-NGFF version from a zarr store.

    Parameters
    ----------
    plate_path
        Path to an OME-Zarr store.

    Returns
    -------
    ``"0.5"`` for Zarr v3 stores (``zarr.json`` present),
    ``"0.4"`` for Zarr v2 stores.
    """
    p = pathlib.Path(plate_path)
    if (p / "zarr.json").exists():
        return "0.5"
    return "0.4"


def get_multi_store_fov_dataframe(plate_paths: list[str | pathlib.Path]) -> pd.DataFrame:
    """Build a combined DataFrame from multiple OME-Zarr stores.

    Each store gets a ``dataset`` column (path stem) and ``store_index`` column.
    Row indices are globally unique across stores.

    Parameters
    ----------
    plate_paths
        List of paths to OME-Zarr stores.

    Returns
    -------
    Combined DataFrame suitable for loading into DuckDB.
    """
    frames: list[pd.DataFrame] = []
    offset = 0

    # Build unique dataset names — use parent dir when stems collide
    paths = [pathlib.Path(p) for p in plate_paths]
    stems = [p.stem for p in paths]
    if len(set(stems)) < len(stems):
        names = [f"{p.parent.name}/{p.stem}" for p in paths]
    else:
        names = stems

    for i, plate_path in enumerate(paths):
        df = get_fov_dataframe(plate_path)
        df["dataset"] = names[i]
        df["store_index"] = i
        df["ome_version"] = detect_ome_version(plate_path)
        df["__row_index__"] = range(offset, offset + len(df))
        offset += len(df)
        frames.append(df)

    return pd.concat(frames, ignore_index=True)


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
