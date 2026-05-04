# nd-embedding-atlas

[![CI][badge-ci]][link-ci] [![Canary][badge-canary]][link-canary] [![Release][badge-release]][link-release] [![Bun][badge-bun]][link-bun] [![License][badge-license]][link-license]

An interactive browser-based dashboard that links high-dimensional AI embeddings to source 5D (TCZYX) image data for rapid exploration and annotation.

## Install

Two ways, ordered by friction. The install script is the supported path; `bunx` is a zero-install option for trying it.

### 1. Try it now (requires [Bun](https://bun.com))

```bash
bunx github:czbiohub-sf/nd-embedding-atlas ./data.zarr
```

Pin a specific release by appending a tag: `bunx github:czbiohub-sf/nd-embedding-atlas#v0.2.0 ./data.zarr`.

First run is ~45 s (Bun clones the repo, installs deps, and builds the frontend). Subsequent runs are cached.

### 2. Install

```bash
curl -fsSL https://raw.githubusercontent.com/czbiohub-sf/nd-embedding-atlas/main/scripts/install.sh | sh
```

Downloads a checksum-verified native binary (~80 MB) plus its libduckdb sidecar (~110 MB) and drops a `ndea` symlink into `$HOME/.local/bin`. Total install size ~190 MB per version under `~/.ndea/versions/<tag>/`.

Environment variables:

| Variable       | Default            | Notes                                                      |
| -------------- | ------------------ | ---------------------------------------------------------- |
| `NDEA_VERSION` | `latest`           | Release tag (e.g. `v0.2.0`).                               |
| `NDEA_CHANNEL` | `stable`           | `stable`, `pre-release`, or `canary` — see Channels below. |
| `NDEA_BIN_DIR` | `$HOME/.local/bin` | Install destination.                                       |

Example: `curl -fsSL .../install.sh | NDEA_VERSION=v0.2.0 NDEA_BIN_DIR=/usr/local/bin sh`.

**Channels:**

- **`stable`** (default) — the latest tagged release (`v0.1.0`, `v0.2.0`, …). Hand-cut.
- **`canary`** — rolling pre-release rebuilt on every push to `main`. Tracks the head of development.
- **`pre-release`** — latest active alpha / beta / release candidate (`v0.1.0-alpha.1`, `v0.1.0-beta.2`, `v0.1.0-rc.1`, …). Cut manually ahead of a stable release; absent between cuts.

```bash
# canary (rolling)
curl -fsSL https://raw.githubusercontent.com/czbiohub-sf/nd-embedding-atlas/main/scripts/install.sh \
  | NDEA_CHANNEL=canary sh

# specific pre-release by tag (any -alpha / -beta / -rc / -dev tag)
curl -fsSL .../install.sh | NDEA_VERSION=v0.1.0-rc.1 sh
```

Self-update via `ndea update --channel <stable|pre-release|canary>`. Roll back a bad
update with `ndea rollback`.

### Update

```bash
ndea update                       # latest stable
ndea update --channel pre-release # latest alpha / beta / rc (when active)
ndea update --channel canary      # rolling, rebuilt on every push to main
ndea rollback                     # restore the previous binary
```

### Shell completions

```bash
# bash / zsh — load on demand
source <(ndea completions bash)
source <(ndea completions zsh)

# fish — drop into the completions dir
ndea completions fish > ~/.config/fish/completions/ndea.fish
```

Updates download the new binary + sidecar into a fresh `~/.ndea/versions/<tag>/` directory and atomically retarget the symlink via `rename(2)`. Long-running `ndea view` sessions keep their open file handle to the old binary — no mid-run replacement. Re-running the curl installer also works.

For the `bunx` path, re-run the `bunx` command — Bun refreshes the clone on the next invocation.

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

[badge-ci]: https://github.com/czbiohub-sf/nd-embedding-atlas/actions/workflows/ci.yml/badge.svg?branch=main
[badge-canary]: https://github.com/czbiohub-sf/nd-embedding-atlas/actions/workflows/canary.yml/badge.svg?branch=main
[badge-release]: https://img.shields.io/github/v/release/czbiohub-sf/nd-embedding-atlas?label=release&color=blue
[badge-bun]: https://img.shields.io/badge/Bun-1.x-000?logo=bun&logoColor=fbf0df
[badge-license]: https://img.shields.io/badge/License-BSD--3--Clause-blue.svg
[link-ci]: https://github.com/czbiohub-sf/nd-embedding-atlas/actions/workflows/ci.yml
[link-canary]: https://github.com/czbiohub-sf/nd-embedding-atlas/releases/tag/canary
[link-release]: https://github.com/czbiohub-sf/nd-embedding-atlas/releases/latest
[link-bun]: https://bun.com
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
