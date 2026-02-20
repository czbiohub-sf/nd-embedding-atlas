---
icon: lucide/microscope
---

# Using with OPS datasets

This guide walks through viewing optical pooled screening (OPS)
datasets with the `nd-embedding-atlas` on the Bruno HPC.

You'll need the following:

| Artifact | Description |
|----------|-------------|
| `*_cell_features.h5ad` | AnnData with per-cell features, obs metadata, and segmentation info |
| `umap_coordinates.csv` | 2D UMAP embedding (separate file from assembly pipeline) |
| OME-Zarr plate | 5D (TCZYX) image data, one FOV per well |

The viewer needs the cell features (as `.zarr` or `.h5ad`) and optionally the
plate for the image crop viewer.

## Prepare the data

The OPS AnnData h5ad files lack embeddings in `obsm`. Use a preparation script to
convert to zarr v3 and inject the UMAP, or you can add them directly to your `.h5ad`.

See `scripts/prepare_ops0094_anndata.py` for a complete example. The script
takes three arguments:

```bash
uv run scripts/prepare_ops0094_anndata.py INPUT_H5AD UMAP_CSV OUTPUT_ZARR
```

The key steps are:

```python title="Step 1: Convert h5ad to zarr v3 with sharding"
import anndata as ad
import zarr
import zarrs  # noqa: F401
from annbatch import write_sharded

zarr.config.set({"codec_pipeline.path": "zarrs.ZarrsCodecPipeline"})

adata = ad.read_h5ad("cell_features.h5ad")
group = zarr.open_group("cell_features.zarr", mode="w", zarr_version=3)
write_sharded(group, adata)
zarr.consolidate_metadata("cell_features.zarr")
```

```python title="Step 2: Inject UMAP into the zarr store"
import numpy as np
import pandas as pd
import zarr

umap_df = pd.read_csv("umap_coordinates.csv", index_col=0)
umap_arr = np.asarray(umap_df[["umap_1", "umap_2"]].values, dtype=np.float32)

zarr.save_array("cell_features.zarr/obsm/X_umap", umap_arr)
zarr.consolidate_metadata("cell_features.zarr")
```

!!! tip "You can skip the zarr conversion — but it's 5x faster"

    The viewer reads `.h5ad` files directly via `anndata.experimental.read_lazy()`.
    If you skip the zarr conversion, you'll need to inject the UMAP into the h5ad
    instead (via h5py + `anndata.io.write_elem`). However, zarr v3 with sharding
    is significantly faster for viewer startup.

    Benchmark on ops0094 (1.38M cells, 39 obs columns):

    | | h5ad | zarr v3 |
    |---|---:|---:|
    | `read_lazy()` | 1.85s | 0.74s |
    | `obs.to_memory()` | 36.7s | 6.8s |
    | **Total** | **38.5s** | **7.5s** |

    For datasets under ~100k cells the difference is negligible.

## Launch the viewer

=== "With plate (image viewer)"

    ```bash
    uv run ndea view /path/to/cell_features.zarr \
      --plate /path/to/plate.zarr
    ```

    Enables the image crop viewer panel — clicking a cell in the scatter
    loads the corresponding FOV and frames the segmentation bounding box.

=== "Without plate (embeddings only)"

    ```bash
    uv run ndea view /path/to/cell_features.zarr
    ```

    Launches the scatter, data table, and charts without the image viewer.
    Useful when you only have the cell features h5ad/zarr and no plate.

Both forms also accept `.h5ad` directly instead of `.zarr`.

### Selecting obs columns

Large OPS datasets can have hundreds of obs columns (CellProfiler features,
morphology metrics, etc.). Use `-c` to load only the columns you need:

```bash
uv run ndea view /path/to/cell_features.zarr \
  --plate /path/to/plate.zarr \
  -c "gene_name,barcode,area_cp1"
```

The `-c` flag accepts:

- **Comma-separated list**: `-c "gene_name,barcode,area_cp1"`
- **Repeated flags**: `-c gene_name -c barcode -c area_cp1`
- **Mixed**: `-c "gene_name,barcode" -c area_cp1`

!!! note "Spatial columns are loaded automatically"

    The viewer auto-detects spatial columns (`well`, `bbox`, `x_cp1`, `y_cp1`,
    etc.) regardless of what you pass to `-c`. When `--plate` is provided, these
    columns are also hidden from the data table to reduce clutter.

## Spatial column auto-detection

The viewer auto-detects spatial columns from your obs metadata with the
following priority:

| Column type | Priority order |
|-------------|---------------|
| **FOV name** | `fov_name` > `well` |
| **Time** | `t` (defaults to 0 if absent) |
| **Bounding box** | `bbox` > `cp_bbox` |
| **Centroid X/Y** | `x`/`y` > `x_cp1`/`y_cp1` > `x_global_pheno`/`y_global_pheno` |

Bounding boxes are parsed from the string format `"[y_min x_min y_max x_max]"`
produced by the OPS assembly pipeline. When a bounding box is available, the
image viewer frames the full segmentation mask; otherwise it centers on the
centroid coordinates.

## OPS0094 example

A ready-to-run script for the `ops0094_20251217` dataset:

```bash
uv run scripts/prepare_ops0094_anndata.py \
  /hpc/projects/icd.ops/ops0094_20251217/3-assembly/feature_extraction_old/ops0094_20251217_cell_features.h5ad \
  /hpc/projects/icd.ops/ops0094_20251217/3-assembly/feature_extraction_old/graphs/1_cell_level/3_embedding/umap_coordinates.csv \
  /hpc/mydata/$USER/data/ops0094_20251217/ops0094_20251217.zarr
```

Then launch:

=== "With plate"

    ```bash
    uv run ndea view /hpc/mydata/$USER/data/ops0094_20251217/ops0094_20251217.zarr \
      --plate /hpc/projects/icd.ops/ops0094_20251217/2-process/ome-zarr/ops0094_20251217.zarr \
      -c "gene_name,barcode,sgRNA"
    ```

=== "Without plate"

    ```bash
    uv run ndea view /hpc/mydata/$USER/data/ops0094_20251217/ops0094_20251217.zarr \
      -c "gene_name,barcode,sgRNA"
    ```

## Dashboard features with OPS data

The dashboard always includes:

- **Embedding scatter** -- UMAP or other embeddings from `obsm`, with color-by for any obs column
- **Data table** -- sortable, cross-filtered metadata
- **Charts** -- distributions of selected obs columns

When launched with `--plate`, you also get:

- **Image viewer** -- OME-Zarr crops centered on the selected cell, with bounding box overlay and dimension sliders

!!! note "Image viewer can be slow on first load"

    The image viewer streams OME-Zarr chunks on demand over the network. The
    first cell click for a given FOV will take a few seconds while chunks are
    fetched. The scatter plot will also feel less responsive while the viewer
    is actively loading chunks, as both share GPU resources.
