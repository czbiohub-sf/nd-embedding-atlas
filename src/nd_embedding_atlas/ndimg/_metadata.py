"""OME-Zarr metadata extraction using iohub."""

from __future__ import annotations

import json
import pathlib
from typing import Any

import numpy as np
import pandas as pd

from nd_embedding_atlas.io import ChannelColors


def get_plate_metadata(plate_path: str | pathlib.Path) -> dict[str, Any]:
    """Extract positions, channels, and scales from an OME-Zarr plate or position.

    Reads metadata directly from zarr.json / .zattrs — no pixel data access.
    Uses precomputed ``clims_per_level`` for contrast when available, falls
    back to OMERO ``window`` fields, then to iohub auto-contrast as last resort.

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
    p = pathlib.Path(plate_path)

    # Try fast path: read everything from zarr.json metadata (no iohub, no pixel reads)
    result = _try_fast_metadata(p)
    if result is not None:
        return result

    # Fallback: iohub path (opens zarr store, may sample pixels for auto-contrast)
    return _iohub_metadata(p)


def _try_fast_metadata(plate_path: pathlib.Path) -> dict[str, Any] | None:
    """Read plate metadata entirely from zarr.json files — no pixel data access.

    Returns None if the metadata is insufficient (missing channels, shape, etc.).
    """
    # Find the first FOV path
    plate_json = plate_path / "zarr.json"
    zattrs = plate_path / ".zattrs"

    if plate_json.exists():
        attrs = json.loads(plate_json.read_text()).get("attributes", {})
        ome = attrs.get("ome", {})
        plate_meta = ome.get("plate")
        if plate_meta:
            # It's a plate — find first well/image
            wells = plate_meta.get("wells", [])
            if not wells:
                return None
            first_well = wells[0]["path"]
            # Read well to find first image
            well_json = plate_path / first_well / "zarr.json"
            if well_json.exists():
                well_attrs = json.loads(well_json.read_text()).get("attributes", {})
                images = well_attrs.get("ome", {}).get("well", {}).get("images", [])
                first_image = images[0]["path"] if images else "0"
            else:
                first_image = "0"
            fov_path = plate_path / first_well / first_image
            store_type = "plate"
            positions = _enumerate_positions_from_json(plate_path, plate_meta)
        else:
            # Single position
            fov_path = plate_path
            store_type = "position"
            positions = ["/"]
    elif zattrs.exists():
        attrs = json.loads(zattrs.read_text())
        plate_meta = attrs.get("plate")
        if plate_meta:
            wells = plate_meta.get("wells", [])
            if not wells:
                return None
            first_well = wells[0]["path"]
            well_zattrs = plate_path / first_well / ".zattrs"
            if well_zattrs.exists():
                well_attrs = json.loads(well_zattrs.read_text())
                images = well_attrs.get("well", {}).get("images", [])
                first_image = images[0]["path"] if images else "0"
            else:
                first_image = "0"
            fov_path = plate_path / first_well / first_image
            store_type = "plate"
            positions = _enumerate_positions_from_json(plate_path, plate_meta)
        else:
            fov_path = plate_path
            store_type = "position"
            positions = ["/"]
    else:
        return None

    # Read FOV-level metadata
    fov_attrs = _read_fov_attrs(fov_path)
    if fov_attrs is None:
        return None

    ome = fov_attrs.get("ome", {})
    multiscales = ome.get("multiscales", [])
    omero = ome.get("omero", {})
    omero_channels = omero.get("channels", [])

    if not multiscales or not omero_channels:
        return None

    # Shape from first dataset array
    ms = multiscales[0]
    datasets = ms.get("datasets", [])
    shape = _read_array_shape(fov_path, datasets[0]["path"] if datasets else "0")
    if shape is None:
        return None

    # Scale from coordinate transformations
    scale = [1.0] * len(shape)
    if datasets:
        transforms = datasets[0].get("coordinateTransformations", [])
        for t in transforms:
            if t.get("type") == "scale":
                scale = t["scale"]

    # Channels: use precomputed clims_per_level if available, else OMERO windows
    clims = fov_attrs.get("clims_per_level", {})
    level0_clims = clims.get("0", {}).get("contrast_limits_per_channel", [])

    channels = []
    for i, ch in enumerate(omero_channels):
        label = ch.get("label", f"Channel {i}")
        color = ch.get("color") or ChannelColors.hex(label)
        window = ch.get("window", {})

        # Prefer precomputed contrast limits over OMERO window defaults
        if i < len(level0_clims):
            lo, hi = level0_clims[i]
            window = {"start": lo, "end": hi, "min": lo, "max": hi}

        channels.append({"label": label, "color": color, "window": window})

    result: dict[str, Any] = {
        "type": store_type,
        "positions": sorted(positions),
        "shape": shape,
        "scale": scale,
        "channel_names": [ch["label"] for ch in channels],
        "channels": channels,
    }

    if len(scale) >= 2:
        result["pixel_scale"] = {"y": scale[-2], "x": scale[-1]}

    return result


def _enumerate_positions_from_json(
    plate_path: pathlib.Path,
    plate_meta: dict,
) -> list[str]:
    """Enumerate position paths from plate JSON metadata without opening zarr."""
    positions = []
    for well in plate_meta.get("wells", []):
        well_path = well["path"]
        well_json = plate_path / well_path / "zarr.json"
        well_zattrs = plate_path / well_path / ".zattrs"

        images = ["0"]  # default
        if well_json.exists():
            well_attrs = json.loads(well_json.read_text()).get("attributes", {})
            imgs = well_attrs.get("ome", {}).get("well", {}).get("images", [])
            if imgs:
                images = [img["path"] for img in imgs]
        elif well_zattrs.exists():
            well_attrs = json.loads(well_zattrs.read_text())
            imgs = well_attrs.get("well", {}).get("images", [])
            if imgs:
                images = [img["path"] for img in imgs]

        positions.extend(f"{well_path}/{img}" for img in images)
    return positions


def _read_fov_attrs(fov_path: pathlib.Path) -> dict | None:
    """Read attributes from a FOV's zarr.json or .zattrs."""
    zarr_json = fov_path / "zarr.json"
    if zarr_json.exists():
        try:
            return json.loads(zarr_json.read_text()).get("attributes", {})
        except (json.JSONDecodeError, KeyError):
            return None

    zattrs = fov_path / ".zattrs"
    if zattrs.exists():
        try:
            return json.loads(zattrs.read_text())
        except (json.JSONDecodeError, KeyError):
            return None

    return None


def _read_array_shape(fov_path: pathlib.Path, dataset_path: str) -> list[int] | None:
    """Read array shape from zarr.json metadata without opening the array."""
    arr_path = fov_path / dataset_path / "zarr.json"
    if arr_path.exists():
        try:
            meta = json.loads(arr_path.read_text())
            return meta.get("shape")
        except (json.JSONDecodeError, KeyError):
            return None

    # Zarr v2: .zarray
    zarray = fov_path / dataset_path / ".zarray"
    if zarray.exists():
        try:
            meta = json.loads(zarray.read_text())
            return meta.get("shape")
        except (json.JSONDecodeError, KeyError):
            return None

    return None


def _iohub_metadata(plate_path: pathlib.Path) -> dict[str, Any]:
    """Fallback: extract metadata via iohub (may sample pixels for auto-contrast)."""
    from iohub.ngff import open_ome_zarr

    dataset = open_ome_zarr(str(plate_path), mode="r")

    result: dict[str, Any] = {}

    if hasattr(dataset, "positions"):
        result["type"] = "plate"
        positions_list = list(dataset.positions())
        result["positions"] = [key for key, _ in positions_list]
        _, first_pos = positions_list[0]
    else:
        result["type"] = "position"
        result["positions"] = ["/"]
        first_pos = dataset

    result["shape"] = list(first_pos.data.shape)
    result["scale"] = list(first_pos.scale)

    channel_names = list(first_pos.channel_names)
    result["channel_names"] = channel_names

    scale = first_pos.scale
    if len(scale) >= 2:
        result["pixel_scale"] = {"y": scale[-2], "x": scale[-1]}

    channels = _read_omero_channels(plate_path, first_pos)
    _apply_auto_contrast(first_pos, channels)
    result["channels"] = channels

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
                "color": ch.get("color") or ChannelColors.hex(ch.get("label", channel_names[i])),
                "window": ch.get("window", {}),
            }
            for i, ch in enumerate(omero_channels)
        ]

    # Fallback: channel names with default colors from channel_colors.yaml
    return [{"label": name, "color": ChannelColors.hex(name), "window": {}} for name in channel_names]


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
