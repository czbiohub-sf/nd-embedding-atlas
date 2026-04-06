# nd-embedding-atlas

|             |                                                                                                                                                                          |
| :---------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
|  **Meta**   | [![Hatch][badge-hatch]][link-hatch] [![uv][badge-uv]][link-uv] [![Ruff][badge-ruff]][link-ruff] [![prek][badge-prek]][link-prek] [![License][badge-license]][link-license] |

An interactive browser-based dashboard that links high-dimensional AI embeddings to source 5D (TCZYX) image data for rapid exploration and annotation.

## Quick start

**1. Install [uv](https://docs.astral.sh/uv/) if you don't have it:**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**2. Install nd-embedding-atlas:**
```bash
uv tool install "https://github.com/czbiohub-sf/nd-embedding-atlas/releases/latest/download/ndea-latest.whl"
```

**3. Launch the viewer:**
```bash
ndea path/to/data.zarr
ndea path/to/data.zarr path/to/plate.zarr   # with OME-Zarr image viewer
ndea path/to/config.yaml                     # multi-dataset config
```

Then open **Chrome or Edge** at `http://localhost:5055`.

> **WebGPU required** — Chrome or Edge on a machine with a GPU. Firefox is not supported.
> On HPC systems, see the [WebGPU setup guide][webgpu-hpc].

## Upgrade

```bash
uv tool install "https://github.com/czbiohub-sf/nd-embedding-atlas/releases/latest/download/ndea-latest.whl" --force
```

## Documentation

Full documentation at [czbiohub-sf.github.io/nd-embedding-atlas][docs-link]:

- [Getting started][docs-index] — installation and first run
- [Preparing your data][docs-data] — OME-Zarr layout, sharding, pyramids
- [OPS datasets][docs-ops] — optical pooled screening workflow
- [WebGPU on HPC][webgpu-hpc] — Chrome flags for HPC systems
- [Contributing][docs-contrib] — dev setup and contribution guide

## What does the UI look like?

<img width="1466" height="1083" alt="image" src="https://github.com/user-attachments/assets/9f70cbee-1853-445e-bb86-c9e5fdd143c1" />

## Contact

For questions and help requests, reach out in the [discussions][discussions-link].
For bugs or feature requests, use the [issue tracker][issue-tracker].

## Citation

> t.b.a.

## Release notes

See the [changelog][].

<!-- badges -->
[badge-hatch]: https://img.shields.io/badge/%F0%9F%A5%9A-Hatch-4051b5.svg
[badge-uv]: https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/uv/main/assets/badge/v0.json
[badge-ruff]: https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json
[badge-prek]: https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/j178/prek/master/docs/assets/badge-v0.json
[badge-license]: https://img.shields.io/badge/License-BSD--3--Clause-blue.svg

[link-hatch]: https://github.com/pypa/hatch
[link-uv]: https://github.com/astral-sh/uv
[link-ruff]: https://github.com/astral-sh/ruff
[link-prek]: https://github.com/j178/prek
[link-license]: https://opensource.org/licenses/BSD-3-Clause

<!-- links -->
[issue-tracker]: https://github.com/czbiohub-sf/nd-embedding-atlas/issues
[discussions-link]: https://github.com/czbiohub-sf/nd-embedding-atlas/discussions
[docs-link]: https://super-adventure-yv3eleq.pages.github.io/
[docs-index]: https://super-adventure-yv3eleq.pages.github.io/
[docs-data]: https://super-adventure-yv3eleq.pages.github.io/preparing-your-data/
[docs-ops]: https://super-adventure-yv3eleq.pages.github.io/ops-datasets/
[webgpu-hpc]: https://super-adventure-yv3eleq.pages.github.io/webgpu-hpc-setup/
[docs-contrib]: https://super-adventure-yv3eleq.pages.github.io/contributing/
[changelog]: CHANGELOG.md
