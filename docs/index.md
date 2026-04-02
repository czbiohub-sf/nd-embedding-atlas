---
icon: lucide/rocket
---

# Getting started

nd-embedding-atlas is an interactive dashboard that links high-dimensional AI embeddings
to their source 5D (TCZYX) image data for rapid exploration and annotation.

!!! warning "AnnData schema expectations are in flux"

    The column names, layout of `obs`/`obsm`/`layers`, and general AnnData
    structure that the viewer recognizes are not yet standardized and will
    change. You may need to adjust your AnnData as we formalize the structure.

!!! info "Browser requirement"

    **Chrome or Edge is required.** The scatter renderer uses WebGPU, which Firefox
    does not support by default. On HPC systems, see the
    [WebGPU setup guide](webgpu-hpc-setup.md) to enable WebGPU in Chrome.

## Installing

### For users (recommended)

Install once with [uv](https://docs.astral.sh/uv/), then run from anywhere:

``` bash
# Install uv if you don't have it
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install nd-embedding-atlas
uv tool install "git+ssh://git@github.com/czbiohub-sf/nd-embedding-atlas.git@main"
```

To upgrade later:

``` bash
uv tool upgrade nd-embedding-atlas
```

### For developers (clone and build)

1. Clone

    ``` bash
    git clone https://github.com/czbiohub-sf/nd-embedding-atlas.git
    cd nd-embedding-atlas
    ```

2. Setup the Python backend

    ```bash
    uv sync
    ```

3. Setup the Frontend

    ```bash
    cd frontend
    pnpm install
    ```

    or 

    ```bash
    vp install
    ```

See the [contributing guide](contributing.md) for the full dev setup.

## Download test data

The project includes scripts to download example datasets. Pick the one that fits your use case:

=== "DynaCLR (cell tracking)"

    Small zarr v3 stores with cell tracking annotations and PCA + PHATE embeddings. Good for quick testing.

    ``` bash
    uv run scripts/download_dynaclr_datasets.py [OUTPUT] # (1)!
    ```

    1. `OUTPUT` -- directory for `.zarr` stores (default: `data/`). Existing stores are skipped.
       Requires `wget` on PATH.

    This downloads two stores into the output directory:

    | Store | Description |
    |-------|-------------|
    | `dataset.zarr` | OME-Zarr v0.5 HCS plate with 5D image data |
    | `annotations_zv3.zarr` | AnnData with tracking annotations and embeddings |

    !!! tip "On the Bruno HPC"

        The DynaCLR datasets are already available at:

        ```
        /hpc/websites/public.czbiohub.org/comp.micro/nd-embedding-atlas-test-data
        ```

        You can point the viewer directly at these paths instead of downloading.

=== "CellxGene (transcriptomics)"

    Larger scRNA-seq datasets from [CellxGene](https://cellxgene.cziscience.com/).
    Downloads `.h5ad` files and converts them to zarr v3 with sharding.

    ``` bash
    uv run scripts/download_cxg_datasets.py [OUTPUT] # (1)!
    ```

    1. `OUTPUT` -- directory for `.zarr` stores (default: `data/`). Existing stores are skipped.
       Downloads to a temp directory first, converts to zarr v3, then cleans up the `.h5ad` files.

    !!! info "This may take a while"

        CellxGene datasets are several GB each.

## Launch the viewer

Pass your data paths directly — the CLI auto-detects AnnData vs OME-Zarr by structure:

=== "DynaCLR (cell tracking)"

    ``` bash
    ndea data/annotations_zv3.zarr data/dataset.zarr
    ```

    The AnnData (`.zarr` with `obs/`) loads the embeddings and metadata.
    The OME-Zarr (`.zarr` without `obs/`) becomes the image viewer.

=== "CellxGene (transcriptomics)"

    ``` bash
    ndea cxg-data/*.zarr # (1)!
    ```

    1. Glob patterns work — all matching AnnData stores are lazily concatenated.



The viewer starts at `http://localhost:5055` with:

- **Embedding scatter** -- interactive WebGPU scatterplot of the embedding space
- **Data table** -- View [`AnnData.obs`][anndata-obs-docs]
- **Image viewer** -- OME-Zarr image crops (when an OME-Zarr store is provided)


[anndata-obs-docs]: https://anndata.readthedocs.io/en/stable/tutorials/notebooks/getting-started.html

## Multi-dataset config

To view multiple AnnData + OME-Zarr pairs together, create a YAML config file:

``` yaml
datasets:
  "experiment-1":
    anndata: path/to/exp1.zarr       # relative to this YAML file, or absolute
    ome-zarr: path/to/plate1.zarr    # optional

  "experiment-2":
    anndata: path/to/exp2.h5ad       # .h5ad files also work
    ome-zarr: path/to/plate2.zarr
```

Then launch:

``` bash
ndea config.yaml
```

## CLI reference

``` bash
ndea --help
```

| Option | Description |
|--------|-------------|
| `--export-dir` / `-e` | Directory for exported zarr stores |
| `--port` | Server port (default: 5055) |
| `--dry-run` | Validate inputs and exit without launching |

## What's next?

- Read [Preparing your data](preparing-your-data.md) for OME-Zarr layout guidance
- See [OPS datasets](ops-datasets.md) for an optical pooled screening workflow example
- Read the [contributing guide](contributing.md)
