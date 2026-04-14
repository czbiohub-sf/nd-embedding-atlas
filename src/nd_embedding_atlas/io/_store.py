"""Shared store helpers for zarr/h5py targeted reads."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


def open_store(path: str | Path):
    """Open a zarr.Group or h5py.File for targeted element reads."""
    p = Path(path)
    if p.is_dir() or p.suffix == ".zarr":
        import zarr

        return zarr.open(str(p), mode="r")
    import h5py

    return h5py.File(str(p), "r")


@contextmanager
def store_ctx(path: str | Path) -> Iterator:
    """Context manager around ``open_store`` -- auto-closes h5py/zarr handles."""
    s = open_store(path)
    try:
        yield s
    finally:
        if hasattr(s, "close"):
            s.close()
