from collections.abc import Callable
from pathlib import Path

import anndata as ad
import zarr
import zarrs  # noqa: F401
from annbatch import DatasetCollection
from obstore.store import LocalStore
from zarr.storage import ObjectStore

zarr.config.set(
    {
        "codec_pipeline.path": "zarrs.ZarrsCodecPipeline",
        "threading.max_workers": None,
    }
)

adata_paths = {f.stem: f for f in Path("../ome-atlas-test-data/cxg-data").glob("*.zarr")}

ds_pre_shuffled_path = Path("../ome-atlas-test-data/ds_pre_shuffled.zarr")

# store = LocalStore(path)
# object_store = ObjectStore(store)


adata_lazy: Callable[[Path], ad.AnnData] = lambda path: ad.experimental.read_lazy(
    store=ObjectStore(LocalStore(path)), load_annotation_index=True
)

# print(adata)

ds_collection = DatasetCollection(ds_pre_shuffled_path)

ds_collection.add_adatas(adata_paths.values())
print(ds_collection._dataset_keys)
