#!/usr/bin/env bash
# Build a single `dist/SHA256SUMS` manifest covering every ndea-* binary in
# dist/. Excludes per-artifact `.sha256` files (those are uploaded too, but
# the combined manifest is what users `shasum -a 256 -c` against).
#
# Invoked after `actions/download-artifact` has merged per-platform
# uploads into dist/.
set -euo pipefail

cd dist
ls -lh
# Hash both binaries (ndea-*) and DuckDB sidecars (libduckdb-*) so users can
# verify either with `shasum -a 256 -c SHA256SUMS --ignore-missing`.
# Use `find` (not bash globs) so a missing class — e.g. an older release
# without libduckdb-* — doesn't blow up `set -e` via shasum's "no such file".
# `mapfile` requires bash 4+ — macOS ships 3.2; while-read keeps the script
# runnable locally for debugging.
files=()
while IFS= read -r f; do files+=("$f"); done < <(
    find . -maxdepth 1 -type f \( -name 'ndea-*' -o -name 'libduckdb-*' \) ! -name '*.sha256' |
        sed 's|^\./||' | sort
)
if [ ${#files[@]} -eq 0 ]; then
    echo "::error::no ndea-* or libduckdb-* artifacts in dist/"
    exit 1
fi
shasum -a 256 "${files[@]}" > SHA256SUMS
echo "---"
cat SHA256SUMS
