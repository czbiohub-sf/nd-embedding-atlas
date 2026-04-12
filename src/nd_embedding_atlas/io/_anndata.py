"""AnnData I/O — obs/obsm access via targeted ``read_elem``.

Only touches the specific zarr/h5py group needed, skipping the expensive
full-store load of ``read_zarr``.  For a 1.38M x 2,345 dataset this cuts
startup from ~20s to ~6s.
"""

from __future__ import annotations

import warnings
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import pandas as pd

from nd_embedding_atlas.io._store import store_ctx

if TYPE_CHECKING:
    import anndata as ad

    PathOrAdata = str | Path | "ad.AnnData" | "DatasetCollection"


# ── Internal helpers ──────────────────────────────────────────────────────


def _read_obs_from_store(path: str | Path, *, columns: list[str] | None = None, include_index: bool = False) -> pd.DataFrame:
    """Read obs via ``read_elem`` — skips X, obsm, layers."""
    import anndata as ad

    with store_ctx(path) as s:
        df = ad.io.read_elem(s["obs"])

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
    """Read a single obsm array via ``read_elem``."""
    import anndata as ad

    with store_ctx(path) as s:
        raw = ad.io.read_elem(s[f"obsm/{key}"])

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
    """Extract obs from an in-memory AnnData via ``scanpy.get.obs_df``."""
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


# ── Public API ────────────────────────────────────────────────────────────


def get_obs(
    source: PathOrAdata,
    *,
    columns: list[str] | None = None,
    include_index: bool = False,
) -> pd.DataFrame:
    """Return obs metadata as a DataFrame.

    Dispatches by source type: path → targeted zarr/h5py read,
    DatasetCollection → per-dataset concat, AnnData → scanpy.
    """
    if isinstance(source, (str, Path)):
        return _read_obs_from_store(source, columns=columns, include_index=include_index)

    from nd_embedding_atlas.io import DatasetCollection

    if isinstance(source, DatasetCollection):
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
    """Return an obsm embedding array via targeted ``read_elem``."""
    if isinstance(source, (str, Path)):
        return _read_obsm_from_store(source, key, dtype=dtype, columns=columns)

    from nd_embedding_atlas.io import DatasetCollection

    if isinstance(source, DatasetCollection):
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
        with store_ctx(source) as s:
            return list(s["obsm"].keys()) if "obsm" in s else []

    from nd_embedding_atlas.io import DatasetCollection

    if isinstance(source, DatasetCollection):
        entry = next(iter(source.datasets.data.values()))
        if entry.path is not None:
            return list_obsm_keys(entry.path)

    return list(source.obsm.keys())
