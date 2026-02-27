from importlib.metadata import version

import zarr
import zarrs

from . import cli, io, ndimg, vz

__all__ = ["cli", "io", "ndimg", "vz"]

__version__ = version("nd-embedding-atlas")

zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline"})
