# nd-embedding-atlas

[![CI][badge-ci]][link-ci] [![Canary][badge-canary]][link-canary] [![Release][badge-release]][link-release] [![Bun][badge-bun]][link-bun] [![License][badge-license]][link-license]

An interactive browser-based dashboard that links high-dimensional AI embeddings to source 5D (TCZYX) image data for rapid exploration and annotation.

## Install

> **Repo is private** — release assets and the install script are gated behind the
> czbiohub-sf GitHub org. Every install / update command needs a token that can
> read the repo. The simplest path uses [`gh`](https://cli.github.com) (the GitHub CLI)
> which most internal users already have for code review.

### 1. Install (recommended, internal)

Authenticate `gh` once, then pipe the script + token in:

```bash
gh auth login   # one-time, if you haven't already

gh api repos/czbiohub-sf/nd-embedding-atlas/contents/scripts/install.sh --jq '.content' \
  | base64 -d \
  | NDEA_GITHUB_TOKEN="$(gh auth token)" sh
```

Downloads a checksum-verified single binary (~185 MB) and drops an `ndea`
symlink into `$HOME/.local/bin`. The binary embeds libduckdb; on first
launch it extracts a copy to `~/.cache/ndea/<tag>/` and dlopens it before
the DuckDB engine boots. One file per version under `~/.ndea/versions/<tag>/`.

Pin a specific release with `NDEA_VERSION`:

```bash
gh api repos/czbiohub-sf/nd-embedding-atlas/contents/scripts/install.sh --jq '.content' \
  | base64 -d \
  | NDEA_VERSION=v0.1.0-beta.0 NDEA_GITHUB_TOKEN="$(gh auth token)" sh
```

Switch channel with `NDEA_CHANNEL`:

```bash
# pre-release (alpha / beta / rc) — most common for internal testers right now
... | NDEA_CHANNEL=pre-release NDEA_GITHUB_TOKEN="$(gh auth token)" sh

# canary (rolling, rebuilt on every push to main)
... | NDEA_CHANNEL=canary NDEA_GITHUB_TOKEN="$(gh auth token)" sh
```

Environment variables:

| Variable            | Default            | Notes                                                                            |
| ------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `NDEA_GITHUB_TOKEN` | _(required)_       | GitHub token with repo read scope. Use `$(gh auth token)` if `gh` is configured. |
| `NDEA_VERSION`      | `latest`           | Release tag (e.g. `v0.1.0-beta.0`).                                              |
| `NDEA_CHANNEL`      | `stable`           | `stable`, `pre-release`, or `canary` — see Channels below.                       |
| `NDEA_BIN_DIR`      | `$HOME/.local/bin` | Install destination.                                                             |

**Channels:**

- **`stable`** (default) — the latest tagged release (`v0.1.0`, `v0.2.0`, …). Hand-cut.
- **`pre-release`** — latest active alpha / beta / release candidate (`v0.1.0-alpha.1`, `v0.1.0-beta.0`, `v0.1.0-rc.1`, …). Cut manually ahead of a stable release; what most internal testers track.
- **`canary`** — rolling pre-release rebuilt on every push to `main`. Tracks the head of development.

### 2. Public install (for once the repo is public)

```bash
# These commands won't work today — kept here as the future canonical path.
curl -fsSL https://raw.githubusercontent.com/czbiohub-sf/nd-embedding-atlas/main/scripts/install.sh | sh
curl -fsSL .../install.sh | NDEA_VERSION=v0.1.0-beta.0 sh
```

### Update

`ndea update` re-runs the same auth flow. Export the token in your shell rc so
self-update + rollback don't need it on the command line:

```bash
# ~/.zshrc / ~/.bashrc
export NDEA_GITHUB_TOKEN="$(gh auth token)"
```

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

Updates download the new binary into a fresh `~/.ndea/versions/<tag>/` directory and atomically retarget the symlink via `rename(2)`. Long-running `ndea view` sessions keep their open file handle to the old binary — no mid-run replacement. Re-running the install command also works.

## Quick start

```bash
ndea path/to/data.zarr            # single AnnData store
ndea a.zarr b.zarr c.zarr         # multiple AnnData stores
ndea path/to/config.yaml          # multi-dataset config (pairs an HCS plate with each AnnData store for the image viewer)
```

Then open **Chrome or Edge** at `http://localhost:5055`.

> **WebGPU required** — Chrome or Edge on a machine with a GPU. Firefox is not supported.
> On HPC systems, see the [WebGPU setup guide][webgpu-hpc].

## Documentation

[Full documentation][docs-link]:

- [Getting started][docs-index] — installation and first run
- [CLI reference][docs-cli] — every subcommand and flag
- [Preparing your data][docs-data] — OME-Zarr layout, sharding, pyramids
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
[docs-cli]: https://super-adventure-yv3eleq.pages.github.io/cli/
[docs-data]: https://super-adventure-yv3eleq.pages.github.io/preparing-your-data/
[webgpu-hpc]: https://super-adventure-yv3eleq.pages.github.io/webgpu-hpc-setup/
[docs-contrib]: https://super-adventure-yv3eleq.pages.github.io/contributing/
[changelog]: CHANGELOG.md
