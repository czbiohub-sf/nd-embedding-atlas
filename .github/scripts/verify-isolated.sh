#!/usr/bin/env bash
# Verify that a freshly-built ndea binary launches from a directory that
# contains ONLY the binary: no sibling libduckdb file and no wrapper.
#
# This is the post-bundle invariant: the binary embeds libduckdb and
# extracts a copy to ~/.cache/ndea/<version>/ on first launch. If that
# path ever regresses (e.g. someone reintroduces sidecar-relative rpath
# lookups), this step catches it.
#
# Required env:
#   ARTIFACT: bare filename inside dist/, e.g. ndea-linux-x64
set -euo pipefail

: "${ARTIFACT:?ARTIFACT env var is required}"

iso="${RUNNER_TEMP:-/tmp}/ndea-iso"
rm -rf "$iso"
mkdir -p "$iso"

cp "dist/$ARTIFACT" "$iso/ndea"
chmod +x "$iso/ndea"

echo "::group::Isolated layout"
ls -lh "$iso"
echo "::endgroup::"

"$iso/ndea" --version
