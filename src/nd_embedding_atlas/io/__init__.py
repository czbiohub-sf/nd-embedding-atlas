"""I/O utilities for nd-embedding-atlas."""

from nd_embedding_atlas.io._channels import ChannelColors
from nd_embedding_atlas.io._config import ColumnMapping, NdeaConfig, load_config
from nd_embedding_atlas.io._mudata import MuDataSource, is_mudata
from nd_embedding_atlas.io._project import ProjectConfig, is_project_config, load_project
from nd_embedding_atlas.io._protocol import DataSource
from nd_embedding_atlas.io._registry import Registry
from nd_embedding_atlas.io.collection import AnnDataCollection, DatasetCollection, DatasetEntry, Datasets

__all__ = [
    "AnnDataCollection",  # backward compat alias
    "ChannelColors",
    "ColumnMapping",
    "DataSource",
    "DatasetCollection",
    "DatasetEntry",
    "Datasets",
    "MuDataSource",
    "NdeaConfig",
    "ProjectConfig",
    "Registry",
    "is_mudata",
    "is_project_config",
    "load_config",
    "load_project",
]
