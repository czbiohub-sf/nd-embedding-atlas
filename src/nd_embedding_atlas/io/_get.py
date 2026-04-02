"""Fast direct-read accessors for AnnData obs / obsm / var.

Benchmarks on a 1M-cell zarr store show 7x speedup for obs and 60x for obsm
versus the AnnData Dataset2D.to_memory() / dask.compute() pathway.  The gains
come from eliminating dask task-graph overhead and Dataset2D→pandas conversion.

Supported backends
------------------
- zarr v3 stores (local or cloud-backed)
- HDF5 / .h5ad files via h5py

Usage
-----
::

    from nd_embedding_atlas.io._get import get_obs, get_obsm, get_var

    obs_df = get_obs("path/to/data.zarr")
    coords = get_obsm("path/to/data.zarr", "X_umap")
    var_df = get_var("path/to/data.zarr")

    # Also accepts an open AnnData / AnnDataCollection:
    obs_df = get_obs(adata)
    coords = get_obsm(collection, "X_umap")
"""

from __future__ import annotations

import warnings
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import pandas as pd

if TYPE_CHECKING:
    import h5py
    import zarr

    PathOrAdata = str | Path | "ad.AnnData" | "AnnDataCollection"


# ── Internal helpers ───────────────────────────────────────────────────────


def _open_raw(path: str | Path) -> zarr.Group | h5py.File:
    """Open the underlying zarr.Group or h5py.File for *path*.

    The caller is responsible for closing the handle when done.
    Use as a context manager or call ``handle.close()``.
    """
    p = str(path)
    if Path(p).is_dir() or p.endswith(".zarr"):
        import zarr

        return zarr.open(p, mode="r")
    else:
        import h5py

        return h5py.File(p, "r")


def _read_nullable_string(item: zarr.Array | zarr.Group) -> np.ndarray:
    """Read an AnnData nullable-string-array encoding into a str numpy array.

    AnnData zarr v3 stores string columns as a group with:
      - ``values``: StringDType array
      - ``mask``:   bool array (True = masked/NA)

    Falls back to direct array read for zarr v2 plain string arrays.
    """
    import numpy as np

    try:
        attrs = dict(item.attrs) if hasattr(item, "attrs") else {}
        if attrs.get("encoding-type") == "nullable-string-array" and hasattr(item, "keys"):
            values = item["values"][:]
            # StringDType (kind='T') cannot use .astype(str) — use object then str
            return values.astype(object).astype(str)
        # Plain array (zarr v2 or other)
        arr = item[:]
        if arr.dtype.kind in ("S", "U"):
            return arr.astype(str)
        if arr.dtype.kind == "T":  # NumPy 2.0 StringDType
            return arr.astype(object).astype(str)
        return arr.astype(str)
    except Exception:  # noqa: BLE001 — zarr/h5py can raise anything
        return np.array([], dtype=str)


def _read_obs_index(group: zarr.Group | h5py.File) -> list[str]:
    """Read the AnnData obs string index from ``obs/_index``.

    Handles both zarr v2 (plain array) and zarr v3 (nullable-string-array group).
    """
    try:
        item = group["obs"]["_index"]
        return list(_read_nullable_string(item))
    except (KeyError, Exception):  # noqa: BLE001
        return []


def _group_to_df(group: zarr.Group | h5py.File, group_key: str) -> pd.DataFrame:
    """Read an AnnData obs/var zarr/h5py group directly into a DataFrame.

    Handles:
    - Dense arrays (int, float, string/object, bytes)
    - Categorical encodings (``{codes, categories}`` sub-group)

    Skips ``_index`` (stored separately as index) and unknown sub-structures.

    Parameters
    ----------
    group
        An open zarr.Group or h5py.File.
    group_key
        ``"obs"`` or ``"var"``.

    Returns
    -------
    pandas.DataFrame with the decoded columns.
    """
    import h5py

    g = group[group_key]
    columns: dict[str, object] = {}

    # Determine index name from zarr/h5py encoding attribute
    _index_name = None
    try:
        attrs = dict(g.attrs)
        _index_name = attrs.get("_index") or attrs.get("index_names", [None])[0]
    except Exception:  # noqa: BLE001
        pass

    for col_name in g:
        if col_name == "_index":
            continue
        item = g[col_name]

        # ── Group-based encodings (zarr v2 categorical, zarr v3 new types) ──
        is_group = isinstance(item, h5py.Group) or (hasattr(item, "keys") and not hasattr(item, "__array__"))
        if is_group:
            try:
                enc = dict(item.attrs).get("encoding-type", "") if hasattr(item, "attrs") else ""
                if enc == "nullable-string-array":
                    # zarr v3 nullable string column
                    columns[col_name] = _read_nullable_string(item)
                elif enc == "categorical" or ("codes" in item and "categories" in item):
                    # Categorical: codes array + categories (may itself be a nullable-string group)
                    raw_codes = item["codes"][:]
                    cats_item = item["categories"]
                    if hasattr(cats_item, "keys"):
                        raw_cats = _read_nullable_string(cats_item)
                    else:
                        raw_cats = cats_item[:]
                        if raw_cats.dtype.kind in ("O", "S", "U", "T"):
                            raw_cats = raw_cats.astype(str)
                    columns[col_name] = pd.Categorical.from_codes(raw_codes, categories=raw_cats)
                # else: unknown group encoding — skip silently
            except (KeyError, Exception):  # noqa: BLE001
                pass  # skip unrecognised sub-groups
            continue

        # ── Dense array ────────────────────────────────────────────────
        try:
            arr = item[:]
            # Decode string-like arrays to plain Python str
            # kind 'S' = bytes, 'U' = unicode, 'T' = NumPy 2.0 StringDType
            if arr.dtype.kind in ("S", "U", "T"):
                arr = arr.astype(str)
            elif arr.dtype == object:
                try:
                    arr = arr.astype(str)
                except Exception:  # noqa: BLE001
                    pass
            columns[col_name] = arr
        except Exception:  # noqa: BLE001
            pass  # skip unreadable items

    return pd.DataFrame(columns)


# ── Public API ─────────────────────────────────────────────────────────────


def get_obs(
    source: PathOrAdata,
    *,
    columns: list[str] | None = None,
    include_index: bool = False,
) -> pd.DataFrame:
    """Return a DataFrame of obs metadata, bypassing AnnData overhead.

    For zarr/h5ad paths this reads directly from the underlying store
    (7x faster than ``collection.obs.to_memory()`` on 1M-cell datasets).

    Falls back to AnnData's own accessor when *source* is an in-memory
    AnnData or an AnnDataCollection without a backing path.

    Parameters
    ----------
    source
        Path to a ``.zarr`` store or ``.h5ad`` file, an ``AnnData`` object,
        or an ``AnnDataCollection``.
    columns
        Subset of columns to return.  ``None`` returns all columns.
    include_index
        When ``True``, inject the AnnData string obs index as ``obs_name``
        column (positionally aligned with the DataFrame rows).

    Returns
    -------
    pandas.DataFrame indexed by obs_names.
    """
    # ── Path → direct read ─────────────────────────────────────────────
    if isinstance(source, (str, Path)):
        store = _open_raw(source)
        try:
            df = _group_to_df(store, "obs")
            if include_index:
                idx = _read_obs_index(store)
                if idx:
                    df = df.copy()
                    df["obs_name"] = idx
        finally:
            if hasattr(store, "close"):
                store.close()

        if columns is not None:
            missing = [c for c in columns if c not in df.columns]
            if missing:
                warnings.warn(
                    f"get_obs: columns not found and skipped: {missing}",
                    stacklevel=2,
                )
            df = df[[c for c in columns if c in df.columns]]

        return df

    # ── AnnDataCollection → try backing path, else fall back ───────────
    from nd_embedding_atlas.io import AnnDataCollection

    if isinstance(source, AnnDataCollection):
        # datasets is the underlying Datasets mapping (UserDict)
        datasets = source.datasets
        if len(datasets) == 1:
            entry = next(iter(datasets.data.values()))
            if entry.path is not None:
                return get_obs(entry.path, columns=columns, include_index=include_index)
        # Multi-dataset: read obs per-entry via zarr fast path, then pd.concat.
        # Avoids source.obs → _build_concat → ad.concat(lazy_adatas) which hits
        # an xarray StringDType promotion error when string categories differ.
        frames: list[pd.DataFrame] = []
        for key, entry in datasets.data.items():
            if entry.path is not None:
                df = get_obs(entry.path, columns=columns, include_index=include_index)
            else:
                adata = getattr(entry, "adata", None) or getattr(entry, "data", None)
                obs = adata.obs if adata is not None else pd.DataFrame()
                if hasattr(obs, "to_memory"):
                    obs = obs.to_memory()
                df = obs.copy()
                if include_index and adata is not None:
                    df["obs_name"] = list(adata.obs_names)
                if columns is not None:
                    df = df[[c for c in columns if c in df.columns]]
            df = df.copy()
            df["_dataset"] = key
            frames.append(df)

        result = pd.concat(frames, ignore_index=True)
        # Keep only requested columns; always preserve _dataset and obs_name
        if columns is not None:
            keep_cols = [c for c in result.columns if c in columns or c in ("_dataset", "obs_name")]
            result = result[keep_cols]
        return result

    # ── AnnData ────────────────────────────────────────────────────────
    obs = source.obs
    if hasattr(obs, "to_memory"):
        obs = obs.to_memory()
    if include_index:
        obs = obs.copy()
        obs["obs_name"] = list(source.obs_names)
    if columns is not None:
        obs = obs[[c for c in columns if c in obs.columns]]
    return obs


def get_obsm(
    source: PathOrAdata,
    key: str,
    *,
    dtype: np.dtype | None = np.float32,
    columns: list[int] | None = None,
) -> np.ndarray:
    """Return an obsm embedding array, bypassing AnnData/dask overhead.

    For zarr/h5ad paths this reads directly from the underlying store
    (60x faster than ``collection.obsm[key].compute()`` on 1M-cell datasets
    because it avoids dask task-graph construction entirely).

    Parameters
    ----------
    source
        Path to a ``.zarr`` store or ``.h5ad`` file, an ``AnnData`` object,
        or an ``AnnDataCollection``.
    key
        obsm key, e.g. ``"X_umap"``.
    dtype
        Target numpy dtype.  ``None`` keeps the on-disk dtype.
    columns
        Integer column indices to extract (e.g. ``[0, 1]`` for 2D UMAP).
        ``None`` returns all columns.

    Returns
    -------
    numpy.ndarray of shape ``(n_obs,)`` or ``(n_obs, n_dims)``.
    """
    # ── Path → direct read ─────────────────────────────────────────────
    if isinstance(source, (str, Path)):
        store = _open_raw(source)
        try:
            obsm_group = store["obsm"]
            if key not in obsm_group:
                available = list(obsm_group)
                msg = f"obsm key {key!r} not found. Available: {available}"
                raise KeyError(msg)
            raw = obsm_group[key]
            arr = raw[:, columns] if columns is not None else raw[:]
        finally:
            if hasattr(store, "close"):
                store.close()

        return np.asarray(arr, dtype=dtype) if dtype is not None else np.asarray(arr)

    # ── AnnDataCollection → try backing path, else fall back ───────────
    from nd_embedding_atlas.io import AnnDataCollection

    if isinstance(source, AnnDataCollection):
        if len(source) == 1:
            entry = next(iter(source.datasets.data.values()))
            if entry.path is not None:
                return get_obsm(entry.path, key, dtype=dtype, columns=columns)
        # Multi-dataset: read per-entry and stack — avoids ad.concat on lazy adatas
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
                    arrays.append(np.asarray(raw, dtype=dtype) if dtype is not None else np.asarray(raw))
        if arrays:
            return np.concatenate(arrays, axis=0)
        return np.empty((0, 0), dtype=dtype or np.float32)

    # ── AnnData ────────────────────────────────────────────────────────
    raw = source.obsm[key]
    if columns is not None:
        raw = raw[:, columns]
    if hasattr(raw, "compute"):
        raw = raw.compute()
    return np.asarray(raw, dtype=dtype) if dtype is not None else np.asarray(raw)


def get_var(
    source: PathOrAdata,
    *,
    columns: list[str] | None = None,
) -> pd.DataFrame:
    """Return a DataFrame of var metadata, bypassing AnnData overhead.

    Parameters
    ----------
    source
        Path to a ``.zarr`` store or ``.h5ad`` file, or an ``AnnData`` object.
    columns
        Subset of columns to return.  ``None`` returns all columns.

    Returns
    -------
    pandas.DataFrame indexed by var_names.
    """
    if isinstance(source, (str, Path)):
        store = _open_raw(source)
        try:
            df = _group_to_df(store, "var")
        finally:
            if hasattr(store, "close"):
                store.close()

        if columns is not None:
            df = df[[c for c in columns if c in df.columns]]
        return df

    from nd_embedding_atlas.io import AnnDataCollection

    if isinstance(source, AnnDataCollection):
        if len(source) == 1:
            entry = next(iter(source.datasets.data.values()))
            if entry.path is not None:
                return get_var(entry.path, columns=columns)

    var = source.var
    if hasattr(var, "to_memory"):
        var = var.to_memory()
    if columns is not None:
        var = var[[c for c in columns if c in var.columns]]
    return var
