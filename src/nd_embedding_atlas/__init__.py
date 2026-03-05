from importlib.metadata import version

import zarr
import zarrs

from . import cli, io, ndimg, server, vz

__all__ = ["cli", "io", "ndimg", "server", "vz"]

__version__ = version("nd-embedding-atlas")

zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline"})
