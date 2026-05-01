#!/usr/bin/env bash
# Generate a per-artifact `<artifact>.sha256` file in the dist/ directory.
#
# Linux runners ship `sha256sum`; macOS runners only have `shasum -a 256`.
# Output format is the same: `<hex>  <filename>` — compatible with
# `shasum -a 256 -c <file>` for verification.
#
# Required env:
#   ARTIFACT — bare filename inside dist/, e.g. ndea-linux-x64
set -euo pipefail

: "${ARTIFACT:?ARTIFACT env var is required}"

cd dist
if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${ARTIFACT}" > "${ARTIFACT}.sha256"
else
    shasum -a 256 "${ARTIFACT}" > "${ARTIFACT}.sha256"
fi
cat "${ARTIFACT}.sha256"
