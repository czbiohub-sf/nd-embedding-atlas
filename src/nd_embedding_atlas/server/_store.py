"""EmbeddingStore — in-process DuckDB for serving Mosaic queries."""

from __future__ import annotations

import concurrent.futures
import os
import threading
import types
from typing import Any, ClassVar

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa

from nd_embedding_atlas.vz._prepare import _obsm_column_prefix

# ═══════════════════════════════════════════════════════════════════════════════
# EmbeddingStore — lazy embedding management via VIEWs
# ═══════════════════════════════════════════════════════════════════════════════


class EmbeddingStore:
    """Manages DuckDB with lazy embedding loading via VIEWs.

    Creates an ``obs_base`` table from the obs DataFrame, and a ``dataset`` VIEW
    that JOINs ``obs_base`` with per-embedding tables as they are registered.

    Parameters
    ----------
    obs_df
        Obs-only DataFrame (no embedding columns).
    hidden_columns
        Column names to exclude from the ``dataset`` VIEW.
    duckdb_threads
        Number of threads for DuckDB's internal parallelism.
        Defaults to ``cpu_count // 2``.
    pool_workers
        Number of worker threads in the shared executor.
        Defaults to ``cpu_count // 2``.
    """

    DEFAULT_OBSM_PRIORITY: ClassVar[list[str]] = ["X_umap", "X_tsne", "X_phate", "X_pca"]

    def __init__(
        self,
        obs_df: pd.DataFrame,
        *,
        hidden_columns: set[str] | None = None,
        duckdb_threads: int | None = None,
        pool_workers: int | None = None,
    ) -> None:
        n_cores = os.cpu_count() or 8
        _duckdb_threads = duckdb_threads or max(n_cores // 2, 4)
        # One worker serialises DuckDB queries; DuckDB parallelises internally via duckdb_threads.
        _pool_workers = pool_workers or 1

        self.con = duckdb.connect(":memory:", config={"threads": _duckdb_threads})
        self._executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=_pool_workers,
            thread_name_prefix="ndea-duckdb",
        )
        self._schema_lock = threading.Lock()
        self._loaded: dict[str, dict[str, Any]] = {}
        self._hidden: set[str] = hidden_columns or set()

        obs_df = obs_df.copy()
        obs_df["__row_index__"] = range(len(obs_df))

        # obs_name is the AnnData string index — stable identity for ObsSets
        if "obs_name" not in obs_df.columns:
            import warnings  # noqa: PLC0415

            warnings.warn(
                "obs_name missing from obs_df; falling back to row index string. "
                "ObsSet identity will be unstable.",
                stacklevel=2,
            )
            obs_df["obs_name"] = obs_df["__row_index__"].astype(str)

        _ = obs_df  # prevent GC — DuckDB scans local Python objects by name
        self.con.sql("CREATE TABLE obs_base AS (SELECT * FROM obs_df)")
        self.con.sql("CREATE INDEX obs_base_row_index ON obs_base(__row_index__)")
        self.con.sql("CREATE INDEX obs_base_obs_name ON obs_base(obs_name)")
        self._rebuild_view()
        self.n_obs = len(obs_df)

    @property
    def executor(self) -> concurrent.futures.ThreadPoolExecutor:
        """Shared thread pool for offloading blocking work to worker threads."""
        return self._executor

    def register_embedding(self, obsm_key: str, coords: np.ndarray) -> None:
        """Register a materialized embedding in DuckDB and rebuild the VIEW.

        Parameters
        ----------
        obsm_key
            Key in ``.obsm`` (e.g. ``"X_umap"``).
        coords
            2-D numpy array of shape ``(n_obs, n_dims)``.
        """
        with self._schema_lock:
            prefix = _obsm_column_prefix(obsm_key)
            table_name = f"emb_{prefix}"
            n_dims = coords.shape[1]

            df = pd.DataFrame({"__row_index__": np.arange(coords.shape[0], dtype=np.int64)})
            for i in range(n_dims):
                df[f"{prefix}_{i}"] = np.asarray(coords[:, i], dtype=np.float32)

            _ = df  # prevent GC — DuckDB scans local Python objects by name
            self.con.sql(f"CREATE TABLE {table_name} AS (SELECT * FROM df)")
            self._loaded[obsm_key] = {"prefix": prefix, "n_dims": n_dims, "table": table_name}
            self._rebuild_view()

    def _rebuild_view(self) -> None:
        """Recreate the ``dataset`` VIEW to include all registered embeddings.

        Hidden columns are excluded from the VIEW but remain in ``obs_base``
        for direct queries (e.g. ``/api/obs``).
        """
        if self._hidden:
            cols = [
                row[0]
                for row in self.con.execute("SELECT column_name FROM (DESCRIBE obs_base)").fetchall()
                if row[0] not in self._hidden
            ]
            select = ", ".join(f'obs_base."{c}"' for c in cols)
        else:
            select = "obs_base.*"
        joins = " ".join(f"LEFT JOIN {meta['table']} USING (__row_index__)" for meta in self._loaded.values())
        emb_cols: list[str] = []
        for meta in self._loaded.values():
            prefix = meta["prefix"]
            emb_cols.extend(f'{meta["table"]}."{prefix}_{i}"' for i in range(meta["n_dims"]))
        emb_select = ", ".join(emb_cols)
        if emb_select:
            self.con.sql(f"CREATE OR REPLACE VIEW dataset AS SELECT {select}, {emb_select} FROM obs_base {joins}")
        else:
            self.con.sql(f"CREATE OR REPLACE VIEW dataset AS SELECT {select} FROM obs_base")

    @property
    def loaded_embeddings(self) -> types.MappingProxyType[str, dict[str, Any]]:
        """Read-only view of loaded obsm keys and their metadata."""
        return types.MappingProxyType(self._loaded)

    def add_obs_column(self, col_name: str, data: pa.Array) -> None:
        """Add a new column to ``obs_base`` and rebuild the VIEW.

        Parameters
        ----------
        col_name
            Name for the new column (must not already exist).
        data
            PyArrow array with exactly ``n_obs`` elements, aligned by ``__row_index__``.
        """
        with self._schema_lock:
            # Register as an Arrow table so DuckDB can join against it reliably
            # (local-variable scans are fragile in executor threads).
            tbl = pa.table({
                "__row_index__": pa.array(np.arange(len(data), dtype=np.int64)),
                col_name: data,
            })
            self.con.register("_var_col_tbl", tbl)
            try:
                self.con.execute(f'ALTER TABLE obs_base ADD COLUMN "{col_name}" FLOAT')
                self.con.execute(
                    f'UPDATE obs_base SET "{col_name}" = t."{col_name}" '
                    f'FROM _var_col_tbl t WHERE obs_base.__row_index__ = t.__row_index__'
                )
            finally:
                self.con.unregister("_var_col_tbl")
            self._rebuild_view()

    def cursor(self) -> duckdb.DuckDBPyConnection:
        """Return a new cursor for thread-safe query execution.

        Use as a context manager: ``with store.cursor() as cur: cur.execute(...)``.
        """
        return self.con.cursor()

    def close(self) -> None:
        """Shut down the thread pool and close the DuckDB connection."""
        self._executor.shutdown(wait=False, cancel_futures=True)
        self.con.close()
