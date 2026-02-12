"""Materialize obs metadata from an AnnDataCollection for the viewer."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pandas as pd

if TYPE_CHECKING:
    from nd_embedding_atlas.io import AnnDataCollection


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
