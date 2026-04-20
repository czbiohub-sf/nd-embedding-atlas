# nd-embedding-atlas

|          |                                                                                                                                                                            |
| :------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| **Meta** | [![Hatch][badge-hatch]][link-hatch] [![uv][badge-uv]][link-uv] [![Ruff][badge-ruff]][link-ruff] [![prek][badge-prek]][link-prek] [![License][badge-license]][link-license] |

An interactive browser-based dashboard that links high-dimensional AI embeddings to source 5D (TCZYX) image data for rapid exploration and annotation.

## Install

Three ways to install `ndea`, ordered from lowest to highest friction.

### 1. Try it now (requires [Bun](https://bun.com))

```bash
bunx github:czbiohub-sf/nd-embedding-atlas ./data.zarr
```

Pin a specific release by appending a tag: `bunx github:czbiohub-sf/nd-embedding-atlas#v0.2.0 ./data.zarr`.

First run is ~45 s (Bun clones the repo, installs deps, and builds the frontend). Subsequent runs are cached.

### 2. Install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/czbiohub-sf/nd-embedding-atlas/main/scripts/install.sh | sh
```

Downloads a checksum-verified native binary (~80 MB) and drops it into `$HOME/.local/bin`. No Bun required.

Environment variables:

| Variable       | Default            | Notes                        |
| -------------- | ------------------ | ---------------------------- |
| `NDEA_VERSION` | `latest`           | Release tag (e.g. `v0.2.0`). |
| `NDEA_BIN_DIR` | `$HOME/.local/bin` | Install destination.         |

Example: `curl -fsSL .../install.sh | NDEA_VERSION=v0.2.0 NDEA_BIN_DIR=/usr/local/bin sh`.

### 3. Manual

Download the binary for your platform from the [Releases page][releases-link], mark it executable, and put it on your `PATH`:

```bash
chmod +x ndea-<os>-<arch>
mv ndea-<os>-<arch> ~/.local/bin/ndea
```

**macOS only** — the binary is unsigned, so Gatekeeper will block it on first run. Strip the quarantine attribute once after downloading:

```bash
xattr -dr com.apple.quarantine ~/.local/bin/ndea
```

### Update

Tier 1 (curl installer) and Tier 3 (manual): re-run the install step. The new binary replaces the old one in place.

Tier 0 (`bunx`): re-run the `bunx` command. Bun refreshes the clone on the next invocation.

Future releases will ship a self-updating binary with `ndea update` and `ndea rollback` (revert the last update). Track progress in [issue #TBD](https://github.com/czbiohub-sf/nd-embedding-atlas/issues).

## Quick start

```bash
ndea path/to/data.zarr
ndea path/to/data.zarr path/to/plate.zarr   # with OME-Zarr image viewer
ndea path/to/config.yaml                     # multi-dataset config
```

Then open **Chrome or Edge** at `http://localhost:5055`.

> **WebGPU required** — Chrome or Edge on a machine with a GPU. Firefox is not supported.
> On HPC systems, see the [WebGPU setup guide][webgpu-hpc].

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
[releases-link]: https://github.com/czbiohub-sf/nd-embedding-atlas/releases
[docs-link]: https://super-adventure-yv3eleq.pages.github.io/
[docs-index]: https://super-adventure-yv3eleq.pages.github.io/
[docs-data]: https://super-adventure-yv3eleq.pages.github.io/preparing-your-data/
[docs-ops]: https://super-adventure-yv3eleq.pages.github.io/ops-datasets/
[webgpu-hpc]: https://super-adventure-yv3eleq.pages.github.io/webgpu-hpc-setup/
[docs-contrib]: https://super-adventure-yv3eleq.pages.github.io/contributing/
[changelog]: CHANGELOG.md
