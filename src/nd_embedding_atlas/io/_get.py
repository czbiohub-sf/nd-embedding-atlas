"""Accessors for AnnData obs / obsm / var.

Uses ``anndata.io.read_elem`` for targeted reads — only touches the specific
zarr/h5py group needed, skipping the expensive full-store load of ``read_zarr``.
For a 1.38M x 2,345 dataset this cuts startup from ~20s to ~6s.
"""

from __future__ import annotations

import warnings
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import pandas as pd

if TYPE_CHECKING:
    import anndata as ad

    PathOrAdata = str | Path | "ad.AnnData" | "AnnDataCollection"


# ── Internal helpers ───────────────────────────────────────────────────────


def _open_store(path: str | Path):
    """Open a zarr.Group or h5py.File for targeted element reads."""
    p = Path(path)
    if p.is_dir() or p.suffix == ".zarr":
        import zarr

        return zarr.open(str(p), mode="r")
    import h5py

    return h5py.File(str(p), "r")


def _read_obs_from_store(path: str | Path, *, columns: list[str] | None = None, include_index: bool = False) -> pd.DataFrame:
    """Read obs directly via ``read_elem`` — skips loading X, obsm, layers."""
    import anndata as ad

    store = _open_store(path)
    try:
        df = ad.io.read_elem(store["obs"])
    finally:
        if hasattr(store, "close"):
            store.close()

    if include_index:
        df = df.copy()
        df["obs_name"] = list(df.index)

    if columns is not None:
        missing = [c for c in columns if c not in df.columns]
        if missing:
            warnings.warn(f"get_obs: columns not found and skipped: {missing}", stacklevel=3)
        df = df[[c for c in columns if c in df.columns]]

    return df


def _read_obsm_from_store(
    path: str | Path,
    key: str,
    *,
    dtype: np.dtype | None = np.float32,
    columns: list[int] | None = None,
) -> np.ndarray:
    """Read a single obsm array via ``read_elem`` — skips loading X, obs, layers."""
    import anndata as ad

    store = _open_store(path)
    try:
        raw = ad.io.read_elem(store[f"obsm/{key}"])
    finally:
        if hasattr(store, "close"):
            store.close()

    if columns is not None:
        raw = raw[:, columns]
    if hasattr(raw, "compute"):
        raw = raw.compute()
    return np.asarray(raw, dtype=dtype) if dtype else np.asarray(raw)


def _obs_from_adata(
    adata: ad.AnnData,
    *,
    columns: list[str] | None = None,
    include_index: bool = False,
) -> pd.DataFrame:
    """Extract obs DataFrame from an in-memory AnnData via ``scanpy.get.obs_df``."""
    import scanpy as sc

    keys = list(adata.obs.columns) if columns is None else [c for c in columns if c in adata.obs.columns]
    df = sc.get.obs_df(adata, keys=keys)
    if include_index:
        df = df.copy()
        df["obs_name"] = list(adata.obs_names)
    if columns is not None:
        missing = [c for c in columns if c not in df.columns]
        if missing:
            warnings.warn(f"get_obs: columns not found and skipped: {missing}", stacklevel=3)
    return df


# ── Public API ─────────────────────────────────────────────────────────────


def get_obs(
    source: PathOrAdata,
    *,
    columns: list[str] | None = None,
    include_index: bool = False,
) -> pd.DataFrame:
    """Return a DataFrame of obs metadata.

    For paths, uses ``anndata.io.read_elem`` to read only the obs group
    (skips X, obsm, layers — 3.5x faster on large datasets).
    For in-memory AnnData, uses ``scanpy.get.obs_df``.

    Parameters
    ----------
    source
        Path to a ``.zarr`` store or ``.h5ad`` file, an ``AnnData`` object,
        or an ``AnnDataCollection``.
    columns
        Subset of columns to return.  ``None`` returns all columns.
    include_index
        When ``True``, inject the AnnData string obs index as ``obs_name``.

    Returns
    -------
    pandas.DataFrame
    """
    if isinstance(source, (str, Path)):
        return _read_obs_from_store(source, columns=columns, include_index=include_index)

    from nd_embedding_atlas.io import AnnDataCollection

    if isinstance(source, AnnDataCollection):
        datasets = source.datasets
        if len(datasets) == 1:
            entry = next(iter(datasets.data.values()))
            if entry.path is not None:
                return get_obs(entry.path, columns=columns, include_index=include_index)

        frames: list[pd.DataFrame] = []
        for key, entry in datasets.data.items():
            if entry.path is not None:
                df = get_obs(entry.path, columns=columns, include_index=include_index)
            else:
                adata = getattr(entry, "adata", None) or getattr(entry, "data", None)
                df = _obs_from_adata(adata, columns=columns, include_index=include_index) if adata else pd.DataFrame()
            df = df.copy()
            df["_dataset"] = key
            frames.append(df)

        result = pd.concat(frames, ignore_index=True)
        if columns is not None:
            result = result[[c for c in result.columns if c in columns or c in ("_dataset", "obs_name")]]
        return result

    return _obs_from_adata(source, columns=columns, include_index=include_index)


def get_obsm(
    source: PathOrAdata,
    key: str,
    *,
    dtype: np.dtype | None = np.float32,
    columns: list[int] | None = None,
) -> np.ndarray:
    """Return an obsm embedding array via targeted ``read_elem``.

    Reads only the requested obsm group — skips X, obs, layers.

    Parameters
    ----------
    source
        Path, AnnData, or AnnDataCollection.
    key
        obsm key, e.g. ``"X_umap"``.
    dtype
        Target numpy dtype.  ``None`` keeps the on-disk dtype.
    columns
        Integer column indices to extract.  ``None`` returns all.

    Returns
    -------
    numpy.ndarray
    """
    if isinstance(source, (str, Path)):
        return _read_obsm_from_store(source, key, dtype=dtype, columns=columns)

    from nd_embedding_atlas.io import AnnDataCollection

    if isinstance(source, AnnDataCollection):
        if len(source) == 1:
            entry = next(iter(source.datasets.data.values()))
            if entry.path is not None:
                return get_obsm(entry.path, key, dtype=dtype, columns=columns)
        arrays = []
        for entry in source.datasets.data.values():
            if entry.path is not None:
                arrays.append(get_obsm(entry.path, key, dtype=dtype, columns=columns))
            else:
                adata = getattr(entry, "adata", None) or getattr(entry, "data", None)
                if adata is not None:
                    raw = adata.obsm[key]
                    if columns is not None:
                        raw = raw[:, columns]
                    if hasattr(raw, "compute"):
                        raw = raw.compute()
                    arrays.append(np.asarray(raw, dtype=dtype) if dtype else np.asarray(raw))
        return np.concatenate(arrays, axis=0) if arrays else np.empty((0, 0), dtype=dtype or np.float32)

    raw = source.obsm[key]
    if columns is not None:
        raw = raw[:, columns]
    if hasattr(raw, "compute"):
        raw = raw.compute()
    return np.asarray(raw, dtype=dtype) if dtype else np.asarray(raw)


def list_obsm_keys(source: PathOrAdata) -> list[str]:
    """Return available obsm keys without loading the full AnnData."""
    if isinstance(source, (str, Path)):
        store = _open_store(source)
        try:
            return list(store["obsm"].keys()) if "obsm" in store else []
        finally:
            if hasattr(store, "close"):
                store.close()

    from nd_embedding_atlas.io import AnnDataCollection

    if isinstance(source, AnnDataCollection):
        entry = next(iter(source.datasets.data.values()))
        if entry.path is not None:
            return list_obsm_keys(entry.path)

    return list(source.obsm.keys())
