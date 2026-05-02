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
shasum -a 256 ndea-* | grep -v '\.sha256$' > SHA256SUMS
echo "---"
cat SHA256SUMS
