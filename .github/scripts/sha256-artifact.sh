#!/usr/bin/env bash
# Generate per-artifact `<file>.sha256` files for every ndea-* binary AND
# every libduckdb-* sidecar in dist/.
#
# Linux runners ship `sha256sum`; macOS runners only have `shasum -a 256`.
# Output format is the same: `<hex>  <filename>` — compatible with
# `shasum -a 256 -c <file>` for verification.
#
# Required env:
#   ARTIFACT — name prefix to scope the hashing (e.g. ndea-linux-x64).
#              Both `dist/${ARTIFACT}` and any matching libduckdb sidecar
#              get hashed; pass empty to hash everything.
set -euo pipefail

: "${ARTIFACT:?ARTIFACT env var is required}"

if command -v sha256sum >/dev/null 2>&1; then
    hasher() { sha256sum "$1" > "$1.sha256"; }
else
    hasher() { shasum -a 256 "$1" > "$1.sha256"; }
fi

cd dist
for f in ${ARTIFACT} libduckdb-*; do
    [ -f "$f" ] || continue
    case "$f" in *.sha256) continue ;; esac
    hasher "$f"
    cat "$f.sha256"
done
