from importlib.metadata import version

import zarr
import zarrs

from . import cli, imviz, io, vz

__all__ = ["cli", "imviz", "io", "vz"]

__version__ = version("nd-embedding-atlas")

zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline"})
