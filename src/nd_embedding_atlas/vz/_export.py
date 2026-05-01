"""Export a subset of an DatasetCollection to zarr v3 with sharding."""

from __future__ import annotations

import importlib.metadata
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from nd_embedding_atlas.io import DatasetCollection


def export_subset(
    collection: DatasetCollection,
    indices: np.ndarray,
    output_path: Path,
    *,
    selection_type: str = "unknown",
    embedding_key: str | None = None,
) -> None:
    """Export a subset of observations to zarr v3 with sharding and provenance.

    Parameters
    ----------
    collection
        The source DatasetCollection.
    indices
        Integer row indices into the concatenated collection.
    output_path
        Destination path for the zarr v3 store.
    selection_type
        How the selection was made (e.g. ``"lasso"``, ``"bbox"``).
    embedding_key
        The obsm key of the embedding used for selection, if any.
    """
    import zarr
    from annbatch import write_sharded

    # Materialize the lazy view — Dataset2D (obs/var) and dask arrays (X/obsm/layers)
    # are not directly writable by write_dispatched. .to_memory() converts to
    # pandas DataFrames and numpy arrays that the zarr writer understands.
    subset = collection[indices].to_memory()

    subset.uns["export_provenance"] = {
        "source_datasets": {k: str(v) for k, v in collection.datasets.paths.items()},
        "selection_type": selection_type,
        "embedding_key": embedding_key,
        "n_obs_selected": len(indices),
        "n_obs_total": collection.n_obs,
        "software": "nd-embedding-atlas",
        "software_version": importlib.metadata.version("nd-embedding-atlas"),
        "timestamp": datetime.now(tz=UTC).isoformat(),
    }

    # Clamp n_obs_per_chunk to n_obs so small selections still write
    # (annbatch raises when chunk size > n_obs).
    n_obs = len(indices)
    group = zarr.open_group(output_path, mode="w", zarr_format=3)
    write_sharded(
        group,
        subset,
        n_obs_per_chunk=min(64, n_obs),
    )
    zarr.consolidate_metadata(output_path)
