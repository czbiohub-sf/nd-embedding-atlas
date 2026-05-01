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

```bash
curl -fsSL https://raw.githubusercontent.com/czbiohub-sf/nd-embedding-atlas/main/scripts/install.sh | sh
```

Downloads a checksum-verified native binary (~80 MB) and drops it into `$HOME/.local/bin`. To upgrade in place:

```bash
ndea update                       # latest stable
ndea update --channel pre-release # latest alpha / beta / rc (when active)
ndea update --channel canary      # rolling, rebuilt on every push to main
```

For developer setup, see the [contributing guide](contributing.md).

## Test data

Sample datasets live in the companion [ome-atlas-test-data](https://github.com/czbiohub-sf/ome-atlas-test-data) repo (clone alongside this one):

```bash
git clone https://github.com/czbiohub-sf/ome-atlas-test-data.git ../ome-atlas-test-data
```

!!! tip "On the Bruno HPC"

    Test datasets are also pre-staged at:

    ```
    /hpc/websites/public.czbiohub.org/comp.micro/nd-embedding-atlas-test-data
    ```

    Symlink or point the viewer directly at these paths instead of cloning.

## Launch the viewer

```bash
# Single AnnData zarr store
ndea path/to/data.zarr

# AnnData + OME-Zarr plate (cell crops on hover)
ndea path/to/data.zarr path/to/plate.zarr

# Multi-dataset YAML config
ndea path/to/config.yaml
```

Then open Chrome or Edge at `http://localhost:5055`.

The viewer ships:

- **Embedding plot** — interactive WebGPU scatter of the embedding space
- **Data table** — sortable, filterable metadata table cross-filtered with the scatter
- **Charts** — cross-filtered distributions of obs columns
- **OME-Zarr image viewer** — image crops on point-hover (when a plate is provided)

## What's next?

- [Preparing your data](preparing-your-data.md) — OME-Zarr layout, sharding, pyramids
- [Contributing](contributing.md) — dev setup, architecture, release flow
- [WebGPU on HPC](webgpu-hpc-setup.md) — Chrome flags for HPC environments
