"""Standalone OME-Zarr image viewer using idetik frontend."""

from nd_embedding_atlas.imviz._metadata import get_plate_metadata
from nd_embedding_atlas.imviz._serve import create_app, serve

__all__ = ["create_app", "get_plate_metadata", "serve"]
