#!/usr/bin/env bash
# Compile the platform-specific ndea binary with embedded frontend assets.
#
# Shared by release.yml + canary.yml. The frontend is built once per job
# (via `vp build`); this script then enumerates dist/frontend/** and
# passes each file as an extra entrypoint to `bun build --compile`.
# Bun embeds those into $bunfs alongside the main entry.
#
# Required env:
#   TARGET   — bun --target value, e.g. bun-darwin-arm64, bun-linux-x64
#   ARTIFACT — output filename, e.g. ndea-darwin-arm64
#
# `--bytecode` precompiles, `--minify` shrinks unused code paths.
set -euo pipefail

: "${TARGET:?TARGET env var is required (bun --target)}"
: "${ARTIFACT:?ARTIFACT env var is required (output filename)}"

mkdir -p dist

# Enumerate frontend assets for embedding in the single-file binary.
mapfile -t frontend_files < <(find dist/frontend -type f | sort)

bun build ./src/cli/index.ts \
    --compile \
    --bytecode \
    --minify \
    "--target=${TARGET}" \
    "--outfile=dist/${ARTIFACT}" \
    "${frontend_files[@]}"
