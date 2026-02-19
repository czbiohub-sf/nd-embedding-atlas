"""Tests for AnnDataCollection h5ad support and CLI input resolution."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from nd_embedding_atlas.cli._app import _resolve_inputs
from nd_embedding_atlas.io import AnnDataCollection


def test_collection_loads_h5ad(h5ad_path: Path):
    """AnnDataCollection can load an h5ad file by path."""
    collection = AnnDataCollection()
    collection["test"] = h5ad_path

    assert collection.n_obs == 3
    assert collection.n_vars == 2


def test_collection_loads_h5ad_str(h5ad_path: Path):
    """AnnDataCollection accepts h5ad as a string path."""
    collection = AnnDataCollection()
    collection["test"] = str(h5ad_path)

    assert collection.n_obs == 3


def test_collection_h5ad_obs_materializes(h5ad_path: Path):
    """obs from an h5ad-backed collection can be materialized."""
    collection = AnnDataCollection()
    collection["test"] = h5ad_path

    obs = collection.obs
    if hasattr(obs, "to_memory"):
        obs = obs.to_memory()
    assert len(obs) == 3
    assert "_dataset" in obs.columns


def test_collection_h5ad_X_computes(h5ad_path: Path):
    """X from an h5ad-backed collection can be computed."""
    collection = AnnDataCollection()
    collection["test"] = h5ad_path

    x = collection.X
    if hasattr(x, "compute"):
        x = x.compute()
    assert x.shape == (3, 2)
    np.testing.assert_allclose(x[0, 0], 1.2, atol=1e-5)


def test_collection_h5ad_entry_has_path(h5ad_path: Path):
    """DatasetEntry stores the source path for h5ad files."""
    collection = AnnDataCollection()
    collection["test"] = h5ad_path

    assert collection.datasets["test"].path == h5ad_path


# -- CLI _resolve_inputs --


def test_resolve_h5ad_file(h5ad_path: Path):
    """Direct h5ad file path is accepted."""
    result = _resolve_inputs([h5ad_path])
    assert result == [h5ad_path]


def test_resolve_directory_finds_h5ad(h5ad_path: Path):
    """Scanning a directory discovers h5ad files."""
    result = _resolve_inputs([h5ad_path.parent])
    assert h5ad_path in result


def test_resolve_ignores_nonexistent(tmp_path: Path):
    """Non-existent h5ad path is ignored."""
    result = _resolve_inputs([tmp_path / "missing.h5ad"])
    assert result == []
