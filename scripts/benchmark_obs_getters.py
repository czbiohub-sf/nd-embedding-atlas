"""Benchmark obs/obsm/var access patterns vs scanpy equivalents.

Usage:
    uv run python scripts/benchmark_obs_getters.py path/to/data.zarr

Measures:
  1. Current prepare_obs() — Dataset2D.to_memory()
  2. Direct zarr → pandas (bypass AnnData entirely)
  3. Direct zarr → pyarrow → pandas
  4. Current obsm materialization — dask.compute()
  5. Direct zarr obsm read — bypass anndata/dask
  6. obsm via numpy memory-map

Reports wall time + peak RSS for each approach.
"""

from __future__ import annotations

import gc
import sys
import time
import tracemalloc
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import anndata as ad
import numpy as np
import pandas as pd


# ── Helpers ────────────────────────────────────────────────────────────────

@contextmanager
def measure(label: str):
    """Context manager: prints wall time and peak memory delta."""
    gc.collect()
    tracemalloc.start()
    t0 = time.perf_counter()
    try:
        yield
    finally:
        elapsed = time.perf_counter() - t0
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        print(f"  {label:<50s}  {elapsed*1000:7.1f} ms  peak Δ {peak/1e6:6.1f} MB")


def _is_zarr(path: str) -> bool:
    p = Path(path)
    return p.is_dir() or path.endswith(".zarr")


def _open_collection(path: str):
    """Open an AnnDataCollection with a single dataset."""
    from nd_embedding_atlas.io import AnnDataCollection

    col = AnnDataCollection()
    col["data"] = path
    return col


def _open_direct(path: str):
    """Open the raw store — zarr.Group for zarr, h5py.File for h5ad."""
    if _is_zarr(path):
        import zarr
        return zarr.open(path, mode="r")
    else:
        import h5py
        return h5py.File(path, "r")


# ── Benchmark 1: obs metadata ──────────────────────────────────────────────

def _read_obs_direct(store) -> pd.DataFrame:
    """Read obs directly from an open h5py.File or zarr.Group."""
    import h5py
    obs_g = store["obs"]
    cats: dict[str, Any] = {}
    for col_name in obs_g:
        col_item = obs_g[col_name]
        # h5py Dataset (scalar array)
        if isinstance(col_item, h5py.Dataset):
            arr = col_item[:]
            if arr.dtype.kind in ("O", "S", "U"):
                arr = arr.astype(str)
            cats[col_name] = arr
        # h5py Group — categorical: {categories, codes}
        elif isinstance(col_item, h5py.Group):
            try:
                codes = col_item["codes"][:]
                raw_cats = col_item["categories"][:]
                if raw_cats.dtype.kind in ("O", "S"):
                    raw_cats = raw_cats.astype(str)
                cats[col_name] = pd.Categorical.from_codes(codes, categories=raw_cats)
            except KeyError:
                pass
        # zarr array
        elif hasattr(col_item, "__array__"):
            cats[col_name] = col_item[:]
        # zarr group — categorical
        elif hasattr(col_item, "keys"):
            try:
                codes = col_item["codes"][:]
                raw_cats = col_item["categories"][:]
                cats[col_name] = pd.Categorical.from_codes(codes, categories=raw_cats)
            except KeyError:
                pass
    return pd.DataFrame(cats)


def bench_obs(path: str) -> None:
    print("\n── obs metadata ──────────────────────────────────────────────────")

    col = _open_collection(path)
    store = _open_direct(path)

    # Warm up
    _ = col.obs

    # 1a. Current: Dataset2D.to_memory() (via AnnDataCollection)
    with measure("1a. collection.obs.to_memory()"):
        df1 = col.obs.to_memory() if hasattr(col.obs, "to_memory") else col.obs

    n_obs, n_cols = df1.shape
    print(f"     shape: {n_obs} × {n_cols} columns")

    # 1b. anndata read_lazy + to_memory (single file, no concat overhead)
    with measure("1b. ad.read_lazy().obs.to_memory()"):
        adata = ad.experimental.read_lazy(path)
        df2 = adata.obs.to_memory() if hasattr(adata.obs, "to_memory") else adata.obs

    assert df1.shape == df2.shape, f"shape mismatch: {df1.shape} vs {df2.shape}"

    # 1c. Direct h5py/zarr read — bypass all AnnData machinery
    with measure("1c. Direct h5py/zarr obs → pd.DataFrame"):
        df3 = _read_obs_direct(store)

    print(f"     direct read: {df3.shape}")

    # 1d. scanpy on already-lazy adata (not full eager load)
    try:
        import scanpy as sc
        with measure("1d. sc.get.obs_df() on lazy adata [obs cols only]"):
            adata_lazy = ad.experimental.read_lazy(path)
            obs_cols = list(adata_lazy.obs_keys()[:10])
            df5 = sc.get.obs_df(adata_lazy, keys=obs_cols)
        print(f"     scanpy obs_df: {df5.shape}")
    except ImportError:
        print("  1d. [scanpy not installed — skipped]")
    except Exception as e:
        print(f"  1d. scanpy error: {e}")


# ── Benchmark 2: obsm embeddings ───────────────────────────────────────────

def bench_obsm(path: str) -> None:
    print("\n── obsm embeddings ──────────────────────────────────────────────")

    col = _open_collection(path)
    store = _open_direct(path)

    # Discover available obsm keys
    if "obsm" not in store:
        print("  No obsm group found — skipping")
        return

    obsm_keys = list(store["obsm"])
    if not obsm_keys:
        print("  No obsm keys found — skipping")
        return

    key = obsm_keys[0]
    print(f"  Using key: {key}  (available: {obsm_keys})")

    # 2a. Current: collection.obsm[key] + dask.compute()
    with measure(f"2a. collection.obsm['{key}'].compute()"):
        coords = col.obsm[key]
        if hasattr(coords, "compute"):
            coords = coords.compute()
        arr1 = np.asarray(coords, dtype=np.float32)

    print(f"     shape: {arr1.shape}")

    # 2b. Direct h5py/zarr array read — bypass all AnnData machinery
    with measure(f"2b. store['obsm/{key}'][:] direct"):
        raw = store["obsm"][key]
        arr2 = np.asarray(raw[:], dtype=np.float32)

    assert arr1.shape == arr2.shape, f"shape mismatch: {arr1.shape} vs {arr2.shape}"

    # 2c. Pre-allocated buffer
    with measure(f"2c. store['obsm/{key}'] → pre-alloc np.empty"):
        raw = store["obsm"][key]
        n, d = raw.shape
        arr3 = np.empty((n, d), dtype=np.float32)
        raw.read_direct(arr3) if hasattr(raw, "read_direct") else arr3.__setitem__(slice(None), raw[:])

    # 2d. anndata read_lazy + compute (single file, no concat)
    with measure(f"2d. ad.read_lazy().obsm['{key}'].compute()"):
        adata = ad.experimental.read_lazy(path)
        raw2 = adata.obsm[key]
        arr4 = np.asarray(raw2.compute() if hasattr(raw2, "compute") else raw2, dtype=np.float32)

    assert arr1.shape == arr4.shape

    # 2e. scanpy obs_df with obsm_keys on lazy adata (if available)
    try:
        import scanpy as sc
        with measure(f"2e. sc.get.obs_df() obsm_keys on lazy adata"):
            adata_lazy2 = ad.experimental.read_lazy(path)
            df = sc.get.obs_df(adata_lazy2, keys=[], obsm_keys=[(key, 0), (key, 1)])
        print(f"     scanpy obsm: {df.shape}")
    except ImportError:
        print("  2e. [scanpy not installed — skipped]")
    except Exception as e:
        print(f"  2e. scanpy error: {e}")


# ── Benchmark 3: var metadata ──────────────────────────────────────────────

def bench_var(path: str) -> None:
    print("\n── var metadata ──────────────────────────────────────────────────")

    store = _open_direct(path)

    if "var" not in store:
        print("  No var group found — skipping")
        return

    # 3a. AnnData read_lazy
    with measure("3a. ad.read_lazy().var.to_memory()"):
        adata = ad.experimental.read_lazy(path)
        var = adata.var
        if hasattr(var, "to_memory"):
            var = var.to_memory()

    print(f"     var shape: {var.shape}")

    # 3b. Direct h5py/zarr read
    with measure("3b. Direct h5py/zarr var → pd.DataFrame"):
        # Reuse the same logic as obs — just point at "var"
        import h5py

        class _VarProxy:
            def __init__(self, s): self._g = s["var"]
            def __iter__(self): return iter(self._g)
            def __getitem__(self, k): return self._g[k]

        df_var = _read_obs_direct(type("S", (), {"__getitem__": lambda _, k: store[k]})())

    print(f"     direct: {df_var.shape}")


# ── Multi-run stats ────────────────────────────────────────────────────────

def bench_repeated(path: str, n: int = 5) -> None:
    """Run the core operations N times and report mean ± std."""
    print(f"\n── Repeated runs (n={n}) ────────────────────────────────────────")

    col = _open_collection(path)
    store = _open_direct(path)
    obsm_keys = list(store["obsm"]) if "obsm" in store else []
    key = obsm_keys[0] if obsm_keys else None

    def _time(fn) -> list[float]:
        times = []
        for _ in range(n):
            gc.collect()
            t0 = time.perf_counter()
            fn()
            times.append(time.perf_counter() - t0)
        return times

    def _fmt(times):
        a = np.array(times) * 1000
        return f"mean {a.mean():7.1f} ms  std {a.std():5.1f} ms  min {a.min():7.1f} ms"

    # obs.to_memory()
    times = _time(lambda: col.obs.to_memory() if hasattr(col.obs, "to_memory") else col.obs)
    print(f"  obs via collection:      {_fmt(times)}")

    times = _time(lambda: _read_obs_direct(store))
    print(f"  obs direct h5py/zarr:    {_fmt(times)}")

    if key:
        def _obsm_current():
            c = col.obsm[key]
            return np.asarray(c.compute() if hasattr(c, "compute") else c, dtype=np.float32)

        times = _time(_obsm_current)
        print(f"  obsm via collection:     {_fmt(times)}")

        raw = store["obsm"][key]
        times = _time(lambda: np.asarray(raw[:], dtype=np.float32))
        print(f"  obsm direct h5py/zarr:   {_fmt(times)}")


# ── Entry point ────────────────────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: uv run python scripts/benchmark_obs_getters.py path/to/data.zarr")
        sys.exit(1)

    zarr_path = sys.argv[1]
    print(f"\nBenchmarking: {zarr_path}")
    print("=" * 70)

    bench_obs(zarr_path)
    bench_obsm(zarr_path)
    bench_var(zarr_path)
    bench_repeated(zarr_path)

    print("\nDone.")


if __name__ == "__main__":
    main()
