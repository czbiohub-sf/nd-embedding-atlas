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

## Prerequisites

Before you begin, make sure you have the following installed:

- [x] **Python 3.12+**
- [x] **[uv](https://docs.astral.sh/uv/)** -- fast Python package manager
- [x] **[pnpm](https://pnpm.io/)** -- for building the frontend
- [x] **wget** -- for downloading test datasets (`brew install wget` on macOS)

## Installation

### Clone and install

``` bash
git clone https://github.com/czbiohub-sf/nd-embedding-atlas.git
cd nd-embedding-atlas
uv sync # (1)!
```

1. This creates a virtual environment and installs all dependencies from the lockfile.

### Build the frontend

``` bash
cd frontend && pnpm install && pnpm build # (1)!
cd ..
```

1. Compiles the React + Vite dashboard into `frontend/dist/`, which the Python server
   serves as static files.

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

        You can symlink or point the viewer directly at these paths instead of downloading.

=== "CellxGene (transcriptomics)"

    Larger scRNA-seq datasets from [CellxGene](https://cellxgene.cziscience.com/).
    Downloads `.h5ad` files and converts them to zarr v3 with sharding. The purpose is to inspect
    the perfomance of the embedding atlas.

    ``` bash
    uv run scripts/download_cxg_datasets.py [OUTPUT] # (1)!
    ```

    1. `OUTPUT` -- directory for `.zarr` stores (default: `data/`). Existing stores are skipped.
       Downloads to a temp directory first, converts to zarr v3, then cleans up the `.h5ad` files.

    !!! info "This may take a while"

        CellxGene datasets are several GB each. The script downloads to a temp
        directory, converts to zarr v3, then cleans up the intermediate `.h5ad` files.

## Launch the viewer

After downloading, launch the viewer on the datasets:

=== "DynaCLR (cell tracking)"

    ``` bash
    uv run ndea view data/annotations_zv3.zarr --plate data/dataset.zarr
    ```

    This loads the tracking annotations with embeddings and connects the
    OME-Zarr HCS plate for cell crop viewing.

=== "CellxGene (transcriptomics)"

    ``` bash
    uv run ndea view cxg-data/*.zarr  # (1)!
    ```

    1. You can use glob patterns to select the AnnData `.zarr` files with lazy concatenation.

The viewer starts a local server at `http://localhost:5055` with:

- **Embedding plot** -- interactive WebGL scatter of the embedding space
- **Data table** -- sortable, filterable metadata table
- **Charts** -- cross-filtered distributions of obs columns
- **OME-Zarr Movie viewer** -- OME-Zarr image crops (when `--plate` is provided)

!!! tip "Short alias"

    `ndea` is an alias for `nd-embedding-atlas`. Both work interchangeably.

## What's next?

- Browse the [API documentation](api.md) for programmatic usage
- Read the [contributing documentation](contributing.md) for architecture details and contribution patterns
