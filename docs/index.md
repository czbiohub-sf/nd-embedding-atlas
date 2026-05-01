---
icon: lucide/rocket
---

# Getting started

nd-embedding-atlas is an interactive dashboard linking high-dimensional AI embeddings to source 5D (TCZYX) image data.

!!! warning "AnnData schema is unstable"

    The viewer's expected `obs` / `obsm` / `layers` shape will change. Expect to adjust your AnnData as the schema firms up.

!!! info "Browser requirement"

    **Chrome or Edge required.** The scatter renderer uses WebGPU; Firefox lacks WebGPU support by default. On HPC, see the [WebGPU setup guide](webgpu-hpc-setup.md).

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/czbiohub-sf/nd-embedding-atlas/main/scripts/install.sh | sh
```

Downloads a checksum-verified ~80 MB native binary into `$HOME/.local/bin`. To upgrade in place:

```bash
ndea update                       # latest stable
ndea update --channel pre-release # latest alpha / beta / rc (when active)
ndea update --channel canary      # rolling, rebuilt on every push to main
```

For developer setup, see the [contributing guide](contributing.md).

## Test data

Sample datasets live in the companion [ome-atlas-test-data](https://github.com/czbiohub-sf/ome-atlas-test-data) repo. Clone alongside this one:

```bash
git clone https://github.com/czbiohub-sf/ome-atlas-test-data.git ../ome-atlas-test-data
```

!!! tip "On the Bruno HPC"

    Test datasets are pre-staged at `/hpc/websites/public.czbiohub.org/comp.micro/nd-embedding-atlas-test-data` — symlink or point the viewer at that path directly.

## Launch the viewer

```bash
# Single AnnData zarr store
ndea view path/to/data.zarr

# Multiple stores side-by-side
ndea view path/to/dataset_a.zarr path/to/dataset_b.zarr

# Project config — the only form that pairs an AnnData store with an OME-Zarr
# plate for hover crops, sets channels, configures per-dataset options.
ndea view path/to/config.yaml
```

Open Chrome or Edge at `http://localhost:5055`.

!!! tip "Shorthand"

    `view` is the default subcommand. `ndea path/to/data.zarr` works the same as `ndea view path/to/data.zarr`. Examples use the explicit form to match `update`, `rollback`, `completions`.

A minimal multi-dataset YAML:

```yaml
datasets:
  - name: my-experiment
    path: path/to/annotations.zarr
    plate_path: path/to/plate.zarr # optional — enables hover crops
```

The viewer ships four panels:

- **Embedding plot** — WebGPU scatter of the embedding space
- **Data table** — sortable, cross-filtered with the scatter
- **Charts** — distributions of obs columns
- **OME-Zarr viewer** — image crops on hover (when `plate_path` is set)

## What's next?

- [CLI reference](cli.md) — every subcommand, flag, env var, and channel
- [Preparing your data](preparing-your-data.md) — OME-Zarr layout, sharding, pyramids
- [Contributing](contributing.md) — dev setup, architecture, release flow
- [WebGPU on HPC](webgpu-hpc-setup.md) — Chrome flags for HPC environments
