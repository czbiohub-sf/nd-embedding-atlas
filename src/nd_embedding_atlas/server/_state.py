"""Shared viewer state for the FastAPI server."""

from __future__ import annotations

import asyncio
import dataclasses
import pathlib
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from nd_embedding_atlas.io import AnnDataCollection
    from nd_embedding_atlas.server._store import EmbeddingStore


@dataclasses.dataclass(frozen=True)
class SpatialColumns:
    """Resolved spatial column names (from config or auto-detection)."""

    fov: str | None = None
    t: str | None = None
    bbox: str | None = None
    x: str | None = None
    y: str | None = None

    @property
    def hidden(self) -> set[str]:
        """Columns to hide from the Mosaic dataset VIEW (just bbox strings)."""
        return {self.bbox} if self.bbox else set()

    @property
    def all_columns(self) -> set[str]:
        """All non-None spatial column names."""
        return {c for c in [self.fov, self.t, self.bbox, self.x, self.y] if c is not None}


@dataclasses.dataclass(frozen=True)
class DatasetConfig:
    """Static per-session metadata for the ``/data`` endpoints."""

    obs_column_names: list[str]
    embedding_props: dict[str, Any]
    has_plate: bool
    plate_meta: dict[str, Any] | None
    default_x: str
    default_y: str
    id_column: str = "__row_index__"


@dataclasses.dataclass
class ExportTaskState:
    """Typed state for the single-slot background export task."""

    task_id: str
    task: asyncio.Task[None]
    status: str = "running"  # "running" | "done" | "error"
    output_path: str | None = None
    n_obs: int | None = None
    error: str | None = None


class ViewerState:
    """All mutable server state for one viewer session.

    Parameters
    ----------
    collection
        The AnnDataCollection being served.
    store
        Initialized EmbeddingStore (obs already loaded into DuckDB).
    available_obsm_keys
        List of obsm keys available in the collection.
    spatial
        Resolved spatial column names.
    export_dir
        Resolved export directory path.
    """

    def __init__(
        self,
        collection: AnnDataCollection,
        store: EmbeddingStore,
        *,
        available_obsm_keys: list[str],
        spatial: SpatialColumns,
        export_dir: pathlib.Path,
    ) -> None:
        self.collection = collection
        self.store = store
        self.available_obsm_keys = available_obsm_keys
        self.spatial = spatial
        self.export_dir = export_dir

        self.loading_tasks: dict[str, asyncio.Task[None]] = {}
        self.load_errors: dict[str, str] = {}
        self.parquet_cache: bytes | None = None
        self.export_task: ExportTaskState | None = None

    @property
    def executor(self):
        """Shared thread pool executor (owned by EmbeddingStore)."""
        return self.store.executor

    def invalidate_parquet_cache(self) -> None:
        """Clear the cached parquet bytes (e.g. after embedding registration)."""
        self.parquet_cache = None

    def shutdown(self) -> None:
        """Gracefully shut down the thread pool and DuckDB connection."""
        self.store.close()
