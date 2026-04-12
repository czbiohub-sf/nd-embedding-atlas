"""Materialize obs metadata from a DataSource for the viewer."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pandas as pd

if TYPE_CHECKING:
    from nd_embedding_atlas.io._config import NdeaConfig
    from nd_embedding_atlas.io._protocol import DataSource
    from nd_embedding_atlas.server._state import SpatialColumns


def prepare_obs(
    source: DataSource,
    *,
    obs_columns: list[str] | None = None,
) -> pd.DataFrame:
    """Materialize only obs metadata (no embeddings).

    Delegates to the source's ``get_obs`` method, which dispatches to the
    appropriate backend (AnnData direct read or MuData merged obs).

    Always injects ``obs_name`` and ``_dataset`` columns for stable identity.
    """
    df = source.get_obs(columns=obs_columns, include_index=True)

    # _dataset column: multi-dataset AnnData adds it via ad.concat.
    # For single-dataset or MuData, inject a default.
    if "_dataset" not in df.columns:
        dataset_key = source.keys[0] if source.keys else "default"
        df = df.copy()
        df["_dataset"] = dataset_key

    return df


def _obsm_column_prefix(obsm_key: str) -> str:
    """Derive column prefix from obsm key.

    For plain keys (``X_umap``), strips leading ``X_`` → ``umap``.
    For modality-prefixed keys (``rna:X_umap``), produces ``rna_umap``.
    """
    if ":" in obsm_key:
        mod, _, key = obsm_key.partition(":")
        return f"{mod}_{key.removeprefix('X_')}"
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
