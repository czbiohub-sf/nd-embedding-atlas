from collections.abc import Mapping
from pathlib import Path
from typing import Annotated, Any

import anndata as ad
import typer
import zarr
import zarrs  # noqa: F401

zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline"})


new_path = Path("../ome-atlas-test-data/annotations_zv3.zarr")


original_v2_path = Path("../ome-atlas-test-data/annotations.zarr")


app = typer.Typer()


def write_sharded(group: zarr.Group, adata: ad.AnnData, chunk_to_shard_ratio: int = 4, shard_exponent: int = 2**18):
    """Write AnnData to a zarr group with sharding."""

    def callback(
        func: ad.experimental.Write,
        g: zarr.Group,
        k: str,
        elem: ad.typing.RWAble,
        dataset_kwargs: Mapping[str, Any],
        iospec: ad.experimental.IOSpec,
    ):
        if iospec.encoding_type in {"array"}:
            dataset_kwargs = {
                "shards": tuple(int(2 ** (shard_exponent / len(elem.shape))) for _ in elem.shape),
                **dataset_kwargs,
            }
            dataset_kwargs["chunks"] = tuple(i // chunk_to_shard_ratio for i in dataset_kwargs["shards"])
        elif iospec.encoding_type in {"csr_matrix", "csc_matrix"}:
            dataset_kwargs = {"shards": (2**16,), "chunks": (2**8,), **dataset_kwargs}
        func(g, k, elem, dataset_kwargs=dataset_kwargs)

    ad.experimental.write_dispatched(group, "/", adata, callback=callback)

    zarr.consolidate_metadata(new_path)


@app.command()
def main(  # noqa: D103
    chunk_to_shard_ratio: int = typer.Option(4),
    shard_exponent: int = typer.Option(18),
    delete_existing: Annotated[
        bool, typer.Option("--delete-existing", "-d", help="Delete existing group", rich_help_panel="Conversion")
    ] = True,
):
    if delete_existing:
        g_new = zarr.open_group(new_path, mode="w", use_consolidated=False, zarr_version=3)
        del g_new

    g_new = zarr.open_group(
        new_path, mode="a", use_consolidated=False, zarr_version=3
    )  # zarr_version 3 is default but note that sharding only works with v3!

    adata = ad.io.read_zarr(original_v2_path)
    adata.obs_names_make_unique()

    write_sharded(g_new, adata, chunk_to_shard_ratio, shard_exponent)


if __name__ == "__main__":
    app()
