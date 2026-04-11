"""Materialize obs metadata from an AnnDataCollection for the viewer."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pandas as pd

if TYPE_CHECKING:
    from nd_embedding_atlas.io import AnnDataCollection
    from nd_embedding_atlas.io._config import NdeaConfig
    from nd_embedding_atlas.server._state import SpatialColumns


def prepare_obs(
    collection: AnnDataCollection,
    *,
    obs_columns: list[str] | None = None,
) -> pd.DataFrame:
    """Materialize only obs metadata (no embeddings).

    Uses the fast direct-read path (zarr/h5py) when possible, bypassing
    AnnData's Dataset2D→pandas overhead (7x faster on 1M-cell zarr stores).

    Always injects ``obs_name`` (AnnData string index) and ``_dataset``
    columns for stable identity and cross-dataset queries.

    Parameters
    ----------
    collection
        The collection to extract obs from.
    obs_columns
        Subset of ``.obs`` columns to include. ``None`` includes all columns.

    Returns
    -------
    pandas DataFrame with obs columns only, plus ``obs_name`` and
    ``_dataset`` identity columns.
    """
    from nd_embedding_atlas.io._get import get_obs

    df = get_obs(collection, columns=obs_columns, include_index=True)

    # _dataset column: ad.concat adds it for multi-dataset. For single-dataset,
    # _build_concat returns the raw AnnData without _dataset — inject it here.
    if "_dataset" not in df.columns:
        dataset_key = collection.keys[0]
        df = df.copy()
        df["_dataset"] = dataset_key

    return df


def _obsm_column_prefix(obsm_key: str) -> str:
    """Derive column prefix from obsm key (strip leading ``X_``)."""
    return obsm_key.removeprefix("X_")


def detect_spatial_columns(
    obs_columns: set[str],
    *,
    columns_config: NdeaConfig | None = None,
) -> SpatialColumns:
    """Detect spatial column names from config or obs column names.

    Parameters
    ----------
    obs_columns
        Set of available obs column names.
    columns_config
        Parsed YAML column mapping. If provided, spatial column names
        are taken from the config instead of auto-detected.

    Returns
    -------
    Frozen dataclass with resolved spatial column names.
    """
    from nd_embedding_atlas.server._state import SpatialColumns

    if columns_config and columns_config.columns:
        cm = columns_config.columns
        return SpatialColumns(fov=cm.fov, t=cm.t, z=None, bbox=cm.bbox, x=cm.x, y=cm.y)

    fov = "fov_name" if "fov_name" in obs_columns else ("well" if "well" in obs_columns else None)
    t = "t" if "t" in obs_columns else None
    z = "z" if "z" in obs_columns else None
    bbox = "bbox" if "bbox" in obs_columns else ("cp_bbox" if "cp_bbox" in obs_columns else None)

    x = y = None
    for xc, yc in [("x", "y"), ("x_cp1", "y_cp1"), ("x_global_pheno", "y_global_pheno")]:
        if xc in obs_columns and yc in obs_columns:
            x, y = xc, yc
            break

    return SpatialColumns(fov=fov, t=t, z=z, bbox=bbox, x=x, y=y)


def parse_bbox(raw: str) -> dict[str, float] | None:
    """Parse a bbox string like ``"[y_min x_min y_max x_max]"`` to a dict.

    Parameters
    ----------
    raw
        Bbox string, e.g. ``"[44055 98779 44238 98919]"``.

    Returns
    -------
    Dict with ``y_min``, ``x_min``, ``y_max``, ``x_max`` keys, or ``None``
    if the string is malformed.
    """
    parts = raw.strip("[]").split()
    if len(parts) != 4:
        return None
    try:
        y_min, x_min, y_max, x_max = (float(v) for v in parts)
    except ValueError:
        return None
    return {"y_min": y_min, "x_min": x_min, "y_max": y_max, "x_max": x_max}
