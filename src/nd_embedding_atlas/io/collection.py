"""AnnDataCollection — AnnData-like interface over multiple lazy-backed datasets.

Internally uses ``ad.concat`` on lazy AnnData objects (from ``read_lazy``) to
present a single concatenated view.  All properties (``.X``, ``.obs``,
``.obsm``, ``.layers``) delegate to this cached concat result and remain lazy.

Supports both zarr stores and ``.h5ad`` (HDF5) files as inputs — ``read_lazy``
handles both backends natively.

Mostly follows spatialdata's ``Elements`` pattern (``UserDict``-based container
with coercion on assignment).

.. note::

    This class is **not thread-safe**.  The ``_concat_cache`` can race
    between a concurrent read (``_build_concat``) and a write
    (``_invalidate_cache`` triggered by ``__setitem__``/``__delitem__``),
    leaving stale data in the cache.  In practice this is fine when the
    collection is only mutated at startup and read-only during serving.
    If hot-reload or runtime mutation is needed, guard ``_concat`` access
    with a ``threading.Lock`` or ``asyncio.Lock``.
"""

import warnings
from collections import UserDict
from collections.abc import Callable, Iterator, KeysView, ValuesView
from dataclasses import dataclass
from pathlib import Path
from typing import Self, override

import anndata as ad
import numpy as np
import pandas as pd
import zarr
import zarr.storage
from anndata._core.xarray import Dataset2D
from rich.console import Console
from rich.tree import Tree

# PEP 695 type aliases
type StoreLike = zarr.storage.StoreLike | zarr.Group


@dataclass(slots=True, frozen=True)
class DatasetEntry:
    """Immutable entry wrapping a lazy AnnData and its source path.

    The AnnData is created via ``anndata.experimental.read_lazy()``.
    """

    adata: ad.AnnData
    path: Path | None = None

    @property
    def n_obs(self) -> int:
        """Number of observations."""
        return self.adata.n_obs

    @property
    def n_vars(self) -> int:
        """Number of variables."""
        return self.adata.n_vars

    @property
    def shape(self) -> tuple[int, int]:
        """Shape of X matrix."""
        return self.adata.shape

    @property
    def var_names(self) -> pd.Index:
        """Variable names."""
        return self.adata.var_names


class Datasets[V: DatasetEntry](UserDict[str, V]):
    """Mapping of names to ``DatasetEntry`` objects.

    Inspired by spatialdata's Elements pattern. Accepts any zarr-compatible
    store on assignment (str, Path, ``ObjectStore``, ``MemoryStore``,
    ``zarr.Group``, ...) and **always coerces to ``DatasetEntry``** via
    ``_make_entry``.  Direct ``DatasetEntry`` assignment is a passthrough.

    Generic over entry type so subclasses can store richer entries
    (e.g. ``MuDataEntry`` for multi-modal).  Override ``_make_entry``
    to control coercion.

    Parameters
    ----------
    on_change
        Optional callback invoked after any mutation (set/delete/clear).
        For example, used by ``AnnDataCollection`` to invalidate its concat cache.
    """

    def __init__(self, on_change: Callable[[], None] | None = None) -> None:
        super().__init__()
        self._on_change = on_change

    def _notify(self) -> None:
        """Notify the parent that the collection has changed."""
        if self._on_change is not None:
            self._on_change()

    # Mutation methods (all notify)

    @override
    def __setitem__(self, key: str, value: StoreLike | V) -> None:
        """Add a dataset, validating and coercing to entry type."""
        self._validate_key(key)
        if isinstance(value, DatasetEntry):
            entry = value
        else:
            entry = self._make_entry(key, value)
        super().__setitem__(key, entry)
        self._notify()

    @override
    def __delitem__(self, key: str) -> None:
        """Remove a dataset and notify parent."""
        super().__delitem__(key)
        self._notify()

    @override
    def clear(self) -> None:
        """Remove all datasets and notify parent."""
        super().clear()
        self._notify()

    @override
    def pop(self, key: str, *args: V) -> V:
        """Remove and return a dataset, notifying parent."""
        result = super().pop(key, *args)
        self._notify()
        return result

    @override
    def popitem(self) -> tuple[str, V]:
        """Remove and return last dataset, notifying parent."""
        result = super().popitem()
        self._notify()
        return result

    # Entry creation

    def _make_entry(self, key: str, value: StoreLike) -> DatasetEntry:
        """Create and validate an entry from input.

        Accepts anything zarr.open_group accepts (str, Path, Store,
        StorePath, ObjectStore, MemoryStore, etc.) plus an already-opened
        zarr.Group or a path to an ``.h5ad`` file.  Loads lazily via
        ``ad.experimental.read_lazy()``.

        Override in subclasses to produce custom entry types.
        """
        path: Path | None = None

        match value:
            case zarr.Group():
                store = value
            case str() | Path() if Path(value).suffix == ".h5ad":
                path = Path(value)
                adata = ad.experimental.read_lazy(path, load_annotation_index=True)
                return self._check_var_names(key, adata, path)
            case str() | Path():
                path = Path(value)
                store = _open_zarr_group(value)
            case _:
                store = _open_zarr_group(value)

        adata = ad.experimental.read_lazy(store, load_annotation_index=True)
        return self._check_var_names(key, adata, path)

    def _check_var_names(self, key: str, adata: ad.AnnData, path: Path | None) -> DatasetEntry:
        """Warn on var_names mismatch and return a ``DatasetEntry``."""
        if self.data:
            first_entry = next(iter(self.data.values()))
            if not first_entry.var_names.equals(adata.var_names):
                warnings.warn(
                    f"Dataset '{key}' has different var_names than first dataset. "
                    f"Will use join='outer' at concat time.",
                    UserWarning,
                    stacklevel=4,
                )

        return DatasetEntry(adata=adata, path=path)

    def _validate_key(self, key: str) -> None:
        """Validate key name."""
        if not key:
            msg = "Dataset key cannot be empty"
            raise ValueError(msg)
        if not key.replace("_", "").replace("-", "").replace(".", "").isalnum():
            msg = f"Invalid key '{key}': use alphanumeric, underscore, hyphen, dot only"
            raise ValueError(msg)

    # Read accessors

    @override
    def keys(self) -> KeysView[str]:
        return self.data.keys()

    @override
    def values(self) -> ValuesView[V]:
        return self.data.values()

    @property
    def paths(self) -> dict[str, Path | None]:
        """Mapping of key -> source path."""
        return {k: v.path for k, v in self.data.items()}


def _open_zarr_group(store: zarr.storage.StoreLike) -> zarr.Group:
    """Open a zarr group from any StoreLike, trying consolidated metadata first.

    Accepts anything zarr.open_group accepts: str, Path, Store, StorePath,
    ObjectStore (obstore), MemoryStore, FsspecStore, etc.
    """
    try:
        return zarr.open_group(store, mode="r", use_consolidated=True)
    except (ValueError, KeyError):
        return zarr.open_group(store, mode="r")


class AnnDataCollection:
    """AnnData-like interface over multiple zarr-backed datasets.

    Internally caches the result of ``ad.concat`` on lazy AnnData objects.
    All properties (``.X``, ``.obs``, ``.obsm``, ``.layers``) delegate to
    the cached concat result and remain fully lazy (Dataset2D obs/var,
    dask-backed X/obsm/layers).

    .. warning::

        Not thread-safe.  For async/FastAPI use, create per-request instances
        or guard with an external lock.

    Parameters
    ----------
    obs_chunk_size
        Reserved for future use with custom dask chunking.

    Examples
    --------
    >>> collection = AnnDataCollection()
    >>> collection["sample_a"] = "data/a.zarr"
    >>> collection["sample_b"] = "data/b.zarr"
    >>>
    >>> collection.obs  # Dataset2D (lazy, concatenated)
    >>> collection.obsm["X_umap"]  # dask array (concatenated)
    >>> collection[0:1000]  # sliced lazy AnnData
    >>> collection["sample_a"]  # single dataset's lazy AnnData
    """

    __slots__ = ("_concat_cache", "_datasets", "_obs_chunk_size")

    def __init__(self, obs_chunk_size: int = 20_000) -> None:
        self._obs_chunk_size = obs_chunk_size
        self._datasets: Datasets[DatasetEntry] = Datasets(on_change=self._invalidate_cache)
        self._concat_cache: ad.AnnData | None = None

    # Dataset Management

    @property
    def datasets(self) -> Datasets[DatasetEntry]:
        """Dict-like access to underlying DatasetEntry objects."""
        return self._datasets

    @property
    def keys(self) -> list[str]:
        """Dataset keys in insertion order."""
        return list(self._datasets.keys())

    def add(self, key: str, path: StoreLike) -> Self:
        """Add a dataset. Returns self for chaining."""
        self._datasets[key] = path
        return self

    def remove(self, key: str) -> Self:
        """Remove a dataset. Returns self for chaining."""
        del self._datasets[key]
        return self

    def _invalidate_cache(self) -> None:
        """Clear cached concat result."""
        self._concat_cache = None

    # Cached Lazy Concat

    @property
    def _concat(self) -> ad.AnnData:
        """Lazily-concatenated AnnData (cached, invalidated on add/remove)."""
        if self._concat_cache is None:
            self._concat_cache = self._build_concat()
        return self._concat_cache

    def _build_concat(self) -> ad.AnnData:
        """Build the concatenated lazy AnnData via ``ad.concat``.

        For single-dataset collections, returns the adata directly with a
        ``_dataset`` obs column added — avoids the overhead of ``ad.concat``
        which can be very slow on large lazy-backed h5ad files.
        """
        if not self._datasets:
            msg = "Collection is empty"
            raise ValueError(msg)

        adatas = {key: entry.adata for key, entry in self.datasets.items()}

        if len(adatas) == 1:
            return next(iter(adatas.values()))

        return ad.concat(
            adatas,
            join="outer",
            label="_dataset",
            index_unique="-",
        )

    # AnnData-like Properties (delegate to _concat)

    @property
    def X(self):
        """Concatenated X (lazy, dask-backed)."""
        return self._concat.X

    @property
    def obs(self) -> Dataset2D | pd.DataFrame:
        """Concatenated obs (Dataset2D if lazy, DataFrame if materialized)."""
        return self._concat.obs

    @property
    def var(self) -> Dataset2D | pd.DataFrame:
        """Var annotation (from concat result)."""
        return self._concat.var

    @property
    def obsm(self):
        """Multi-dimensional obs annotations (lazy, dask-backed)."""
        return self._concat.obsm

    @property
    def layers(self):
        """Layers (lazy, dask-backed)."""
        return self._concat.layers

    @property
    def obs_names(self) -> pd.Index:
        """Observation names (concatenated, unique via index_unique)."""
        return self._concat.obs_names

    @property
    def var_names(self) -> pd.Index:
        """Variable names (from concat result, reflects outer join)."""
        return self._concat.var_names

    @property
    def n_obs(self) -> int:
        """Total observations across all datasets.

        Computed from entries directly (does not trigger concat).
        """
        return sum(entry.n_obs for entry in self._datasets.values())

    @property
    def n_vars(self) -> int:
        """Number of variables in the concatenated result.

        Delegates to the concat result so outer-join expansions are
        correctly reflected.
        """
        return self._concat.n_vars

    @property
    def shape(self) -> tuple[int, int]:
        """Shape of concatenated data matrix."""
        return (self.n_obs, self.n_vars)

    # Per-Dataset Access

    def adata(self, key: str) -> ad.AnnData:
        """Get a single dataset's lazy AnnData."""
        if key not in self._datasets:
            msg = f"Dataset '{key}' not in collection"
            raise KeyError(msg)
        return self._datasets[key].adata

    # Slicing

    def __getitem__(self, key: str | int | slice | np.ndarray) -> ad.AnnData:
        """Slice the collection.

        - ``str`` -> single dataset as lazy AnnData
        - ``int``, ``slice``, ``np.ndarray`` -> slice into concatenated view
        """
        match key:
            case str():
                return self.adata(key)
            case int() | slice() | np.ndarray():
                return self._concat[key]
            case _:
                raise TypeError(f"Invalid key type: {type(key)}")  # noqa: TRY003

    def __setitem__(self, key: str, value: StoreLike) -> None:
        """Add dataset (cache invalidated via Datasets callback)."""
        self._datasets[key] = value

    def __delitem__(self, key: str) -> None:
        """Remove dataset (cache invalidated via Datasets callback)."""
        del self._datasets[key]

    def __contains__(self, key: object) -> bool:
        return key in self._datasets

    def __iter__(self) -> Iterator[str]:
        """Iterate over dataset keys."""
        return iter(self._datasets)

    def __len__(self) -> int:
        """Number of datasets."""
        return len(self._datasets)

    # Context Manager

    def _close(self) -> None:
        """Close all zarr stores and release the cached concat."""
        self._invalidate_cache()  # Release concat references first
        for entry in self._datasets.values():
            file_mgr = getattr(entry.adata, "file", None)
            if file_mgr is not None and hasattr(file_mgr, "close"):
                file_mgr.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        self._close()

    # Repr

    def __repr__(self) -> str:
        if not self._datasets:
            return "AnnDataCollection(empty)"

        tree = Tree(f"AnnDataCollection with n_obs x n_vars = {self.n_obs:,} x {self.n_vars:,}")

        datasets_branch = tree.add(f"backed by {len(self._datasets)} dataset(s)")
        for key, entry in self._datasets.items():
            n_obs, n_vars = entry.shape
            path_str = f" @ {entry.path}" if entry.path else ""
            datasets_branch.add(f"'{key}': {n_obs:,} x {n_vars:,}{path_str}")
        # Use per-entry keys to avoid triggering concat for repr
        obsm_keys: set[str] | None = None
        layer_keys: set[str] | None = None
        for entry in self._datasets.values():
            ok = set(entry.adata.obsm.keys())
            lk = set(entry.adata.layers.keys())
            obsm_keys = ok if obsm_keys is None else obsm_keys & ok
            layer_keys = lk if layer_keys is None else layer_keys & lk
        if obsm_keys:
            tree.add(f"obsm: {', '.join(repr(k) for k in sorted(obsm_keys))}")
        if layer_keys:
            tree.add(f"layers: {', '.join(repr(k) for k in sorted(layer_keys))}")

        console = Console(force_terminal=False)
        with console.capture() as capture:
            console.print(tree)
        return capture.get()
