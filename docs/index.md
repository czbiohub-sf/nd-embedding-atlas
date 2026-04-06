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

## Installation

Requires **[uv](https://docs.astral.sh/uv/)** and the **[GitHub CLI](https://cli.github.com/)** (`gh auth login` once to authenticate).

``` bash
# Download the latest release wheel
gh release download --repo czbiohub-sf/nd-embedding-atlas \
  -p "nd_embedding_atlas-*.whl" -D /tmp/ndea/

# Install (no Node.js required — frontend is bundled)
uv tool install /tmp/ndea/nd_embedding_atlas-*.whl
```

To upgrade, re-run the above and add `--force` to the install command.

For developer setup, see the [contributing guide](contributing.md).

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
