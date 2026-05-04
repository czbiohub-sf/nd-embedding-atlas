#!/usr/bin/env bash
# Validate that a freshly-built ndea binary + libduckdb sidecar actually
# launches when isolated from the working tree (no node_modules siblings).
#
# This catches the bug class that motivated the dylib-sidecar plan: the
# bun-compiled binary loads duckdb.node from $bunfs/, which then tries to
# resolve libduckdb relative to its own location. Inside the working tree
# that "happens to work" because of the @duckdb/node-bindings-* node_modules
# entry; outside, it fails.
#
# We isolate the binary into runner.temp/ndea-iso/ alongside ONLY the
# sidecar dylib, set LD_LIBRARY_PATH manually (mirroring what the wrapper
# does in production), and run --version. The wrapper itself is tested
# end-to-end by install-script.yml + verify-release.yml; this step's job
# is to validate the binary <-> sidecar pair, not the wrapper.
#
# Required env:
#   ARTIFACT — bare filename inside dist/, e.g. ndea-linux-x64
#   DYLIB    — bare filename of the matching libduckdb sidecar in dist/,
#              e.g. libduckdb-bun-linux-x64.so
set -euo pipefail

: "${ARTIFACT:?ARTIFACT env var is required}"
: "${DYLIB:?DYLIB env var is required}"

case "$DYLIB" in
    *.dylib) ext=dylib ;;
    *.so) ext=so ;;
    *) echo "::error::unrecognized dylib extension in '$DYLIB'"; exit 1 ;;
esac

iso="${RUNNER_TEMP:-/tmp}/ndea-iso"
rm -rf "$iso"
mkdir -p "$iso"

cp "dist/$ARTIFACT" "$iso/ndea.bin"
cp "dist/$DYLIB" "$iso/libduckdb.$ext"
chmod +x "$iso/ndea.bin"

echo "::group::Isolated layout"
ls -lh "$iso"
echo "::endgroup::"

LD_LIBRARY_PATH="$iso" "$iso/ndea.bin" --version
