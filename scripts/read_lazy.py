from pathlib import Path

import anndata as ad
import zarr
import zarrs  # noqa: F401
from obstore.store import LocalStore
from zarr.storage import ObjectStore

zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline"})


path = Path("../ome-atlas-test-data/annotations_zv3.zarr")


store = LocalStore(path)
object_store = ObjectStore(store)


adata_lazy = ad.experimental.read_lazy(store=object_store, load_annotation_index=True)

# print(adata)
print(adata_lazy.obs["track_id"])
