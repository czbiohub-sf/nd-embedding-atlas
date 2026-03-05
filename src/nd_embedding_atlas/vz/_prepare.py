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

    Parameters
    ----------
    collection
        The collection to extract obs from.
    obs_columns
        Subset of ``.obs`` columns to include. ``None`` includes all columns.

    Returns
    -------
    pandas DataFrame with obs columns only.
    """
    obs = collection.obs
    if hasattr(obs, "to_memory"):
        obs = obs.to_memory()
    if obs_columns is not None:
        obs = obs[obs_columns]
    return obs


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
        return SpatialColumns(fov=cm.fov, t=cm.t, bbox=cm.bbox, x=cm.x, y=cm.y)

    fov = "fov_name" if "fov_name" in obs_columns else ("well" if "well" in obs_columns else None)
    t = "t" if "t" in obs_columns else None
    bbox = "bbox" if "bbox" in obs_columns else ("cp_bbox" if "cp_bbox" in obs_columns else None)

    x = y = None
    for xc, yc in [("x", "y"), ("x_cp1", "y_cp1"), ("x_global_pheno", "y_global_pheno")]:
        if xc in obs_columns and yc in obs_columns:
            x, y = xc, yc
            break

    return SpatialColumns(fov=fov, t=t, bbox=bbox, x=x, y=y)


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
