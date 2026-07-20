#!/usr/bin/env bash
# Generate a per-artifact `<file>.sha256` file for the ndea-* binary in dist/.
#
# Linux runners ship `sha256sum`; macOS runners only have `shasum -a 256`.
# Output format is the same: `<hex>  <filename>`, compatible with
# `shasum -a 256 -c <file>` for verification.
#
# Required env:
#   ARTIFACT: bare filename inside dist/ to hash (e.g. ndea-linux-x64).
set -euo pipefail

: "${ARTIFACT:?ARTIFACT env var is required}"

if command -v sha256sum >/dev/null 2>&1; then
    hasher() { sha256sum "$1" >"$1.sha256"; }
else
    hasher() { shasum -a 256 "$1" >"$1.sha256"; }
fi

cd dist
hasher "$ARTIFACT"
cat "$ARTIFACT.sha256"
