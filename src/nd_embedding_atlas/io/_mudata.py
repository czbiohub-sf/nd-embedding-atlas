"""MuData I/O — obs/obsm/var access + MuDataSource for multi-modal stores.

Reads directly from per-modality zarr groups via ``read_elem``,
mirroring the targeted read strategy in ``_anndata.py``.
"""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from nd_embedding_atlas.io._store import store_ctx

# ── Detection ─────────────────────────────────────────────────────────────


def is_mudata(path: str | Path) -> bool:
    """Return True if *path* is a MuData store (.h5mu or zarr with mod/)."""
    p = Path(path)
    if p.is_file() and p.suffix == ".h5mu":
        return True
    return p.is_dir() and p.suffix == ".zarr" and (p / "mod").is_dir()


def list_modalities(path: str | Path) -> list[str]:
    """Return sorted modality names from a MuData store."""
    with store_ctx(path) as s:
        return sorted(s["mod"].keys()) if "mod" in s else []


# ── obs ───────────────────────────────────────────────────────────────────


def get_obs_mudata(
    path: str | Path,
    *,
    columns: list[str] | None = None,
    include_index: bool = False,
) -> pd.DataFrame:
    """Return merged obs from all modalities.

    Column collisions between modalities are resolved by prefixing
    (``modality:column``).  Shared columns from top-level ``.obs`` stay
    unprefixed.
    """
    import anndata as ad

    with store_ctx(path) as s:
        top_obs = ad.io.read_elem(s["obs"])
        modalities = sorted(s["mod"].keys())
        mod_frames = {m: ad.io.read_elem(s[f"mod/{m}/obs"]) for m in modalities}

    # Build merged DataFrame via pd.concat to avoid fragmentation.
    parts: list[pd.DataFrame] = [top_obs]
    if include_index:
        parts.append(pd.DataFrame({"obs_name": list(top_obs.index)}, index=top_obs.index))

    seen = set(top_obs.columns) | ({"obs_name"} if include_index else set())
    for mod_name in modalities:
        mod_df = mod_frames[mod_name].reindex(top_obs.index)
        rename = {c: f"{mod_name}:{c}" for c in mod_df.columns if c in seen}
        seen.update(c for c in mod_df.columns if c not in rename)
        parts.append(mod_df.rename(columns=rename) if rename else mod_df)

    merged = pd.concat(parts, axis=1).reset_index(drop=True)

    if columns is not None:
        keep = [c for c in merged.columns if c in columns or c == "obs_name"]
        missing = [c for c in columns if c not in merged.columns]
        if missing:
            warnings.warn(f"get_obs_mudata: columns not found and skipped: {missing}", stacklevel=2)
        merged = merged[keep]

    return merged


# ── obsm ──────────────────────────────────────────────────────────────────


def get_obsm_mudata(
    path: str | Path,
    key: str,
    *,
    dtype: np.dtype | None = np.float32,
    columns: list[int] | None = None,
) -> np.ndarray:
    """Return an obsm array from a MuData modality.

    *key* is ``"modality:obsm_key"`` (e.g. ``"rna:X_umap"``).
    """
    import anndata as ad

    mod_name, obsm_key = parse_modality_key(key)
    with store_ctx(path) as s:
        raw = ad.io.read_elem(s[f"mod/{mod_name}/obsm/{obsm_key}"])

    if columns is not None:
        raw = raw[:, columns]
    if hasattr(raw, "compute"):
        raw = raw.compute()
    return np.asarray(raw, dtype=dtype) if dtype else np.asarray(raw)


def list_obsm_keys_mudata(path: str | Path) -> list[str]:
    """Return all obsm keys across modalities, prefixed ``modality:key``."""
    with store_ctx(path) as s:
        keys: list[str] = []
        for mod in sorted(s["mod"].keys()) if "mod" in s else []:
            group_path = f"mod/{mod}/obsm"
            if group_path in s:
                keys.extend(f"{mod}:{k}" for k in sorted(s[group_path].keys()))
        return keys


# ── per-modality obs columns ──────────────────────────────────────────────


def get_obs_columns_by_modality(path: str | Path) -> dict[str, list[str]]:
    """Return ``{modality: [col_names]}`` for obs columns per modality."""
    import anndata as ad

    with store_ctx(path) as s:
        modalities = sorted(s["mod"].keys()) if "mod" in s else []
        return {m: list(ad.io.read_elem(s[f"mod/{m}/obs"]).columns) for m in modalities}


# ── var ───────────────────────────────────────────────────────────────────


def get_var_names_mudata(path: str | Path, modality: str) -> list[str]:
    """Return var names for a specific modality."""
    import anndata as ad

    with store_ctx(path) as s:
        return list(ad.io.read_elem(s[f"mod/{modality}/var"]).index)


def get_n_vars_mudata(path: str | Path) -> dict[str, int]:
    """Return ``{modality: n_vars}`` for all modalities."""
    import anndata as ad

    with store_ctx(path) as s:
        return {
            m: len(ad.io.read_elem(s[f"mod/{m}/var"]))
            for m in (sorted(s["mod"].keys()) if "mod" in s else [])
        }


# ── Helpers ───────────────────────────────────────────────────────────────


def parse_modality_key(key: str) -> tuple[str, str]:
    """Split ``"modality:obsm_key"`` → ``(modality, obsm_key)``."""
    if ":" not in key:
        msg = f"Expected 'modality:key' format, got {key!r}"
        raise ValueError(msg)
    mod, _, obsm_key = key.partition(":")
    return mod, obsm_key


# ── MuDataSource ──────────────────────────────────────────────────────────


class MuDataSource:
    """Wraps a MuData path, satisfies the ``DataSource`` protocol.

    Caches modality list and var counts at construction time.
    All obs/obsm reads are one-shot (no persistent handles).
    """

    __slots__ = ("_modalities", "_n_obs", "_obs_columns_by_mod", "_path", "_var_counts")

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path).resolve()
        self._modalities = list_modalities(self._path)
        self._var_counts = get_n_vars_mudata(self._path)
        self._obs_columns_by_mod = get_obs_columns_by_modality(self._path)

        import anndata as ad

        with store_ctx(self._path) as s:
            self._n_obs = len(ad.io.read_elem(s["obs"]))

    # ── DataSource protocol ──────────────────────────────────────────

    @property
    def n_obs(self) -> int:
        return self._n_obs

    @property
    def n_vars(self) -> int:
        return sum(self._var_counts.values())

    @property
    def shape(self) -> tuple[int, int]:
        return (self._n_obs, self.n_vars)

    @property
    def keys(self) -> list[str]:
        return self._modalities

    def get_obs(
        self,
        *,
        columns: list[str] | None = None,
        include_index: bool = False,
    ) -> pd.DataFrame:
        """Return merged obs from all modalities."""
        return get_obs_mudata(self._path, columns=columns, include_index=include_index)

    def get_obsm(
        self,
        key: str,
        *,
        dtype: np.dtype | None = np.float32,
        columns: list[int] | None = None,
    ) -> np.ndarray:
        """Return an obsm array (key is ``modality:obsm_key``)."""
        return get_obsm_mudata(self._path, key, dtype=dtype, columns=columns)

    def obsm_keys(self) -> list[str]:
        """All obsm keys across modalities, prefixed ``modality:key``."""
        return list_obsm_keys_mudata(self._path)

    # ── MuData-specific ──────────────────────────────────────────────

    @property
    def path(self) -> Path:
        """Resolved path to the MuData store."""
        return self._path

    @property
    def modalities(self) -> list[str]:
        return self._modalities

    @property
    def var_counts(self) -> dict[str, int]:
        return self._var_counts

    @property
    def obs_columns_by_modality(self) -> dict[str, list[str]]:
        """Per-modality obs column names."""
        return self._obs_columns_by_mod

    def __repr__(self) -> str:
        mods = ", ".join(self._modalities)
        return f"MuDataSource({self._path}, modalities=[{mods}], n_obs={self._n_obs:,})"
