#!/usr/bin/env bash
# Build a single `dist/SHA256SUMS` manifest covering every ndea-* binary
# in dist/. Excludes per-artifact `.sha256` files (those are uploaded too,
# but the combined manifest is what users `shasum -a 256 -c` against).
#
# Invoked after `actions/download-artifact` has merged per-platform
# uploads into dist/.
set -euo pipefail

cd dist
ls -lh
# Use `find` (not bash globs) so a missing class doesn't blow up `set -e`
# via shasum's "no such file". `mapfile` requires bash 4+, but macOS ships
# 3.2; while-read keeps the script runnable locally for debugging.
files=()
while IFS= read -r f; do files+=("$f"); done < <(
    find . -maxdepth 1 -type f -name 'ndea-*' ! -name '*.sha256' |
        sed 's|^\./||' | sort
)
if [ ${#files[@]} -eq 0 ]; then
    echo "::error::no ndea-* artifacts in dist/"
    exit 1
fi
shasum -a 256 "${files[@]}" >SHA256SUMS
echo "---"
cat SHA256SUMS
