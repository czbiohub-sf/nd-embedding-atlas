#!/usr/bin/env bash
# Compile the platform-specific ndea binary (full-stack executable: the
# server's index.html import embeds the frontend bundle).
#
# Required env:
#   TARGET: bun --target value, e.g. bun-darwin-arm64, bun-linux-x64
#   ARTIFACT: output filename, e.g. ndea-darwin-arm64
set -euo pipefail

: "${TARGET:?TARGET env var is required (bun --target)}"
: "${ARTIFACT:?ARTIFACT env var is required (output filename)}"

mkdir -p dist

# Runs `build:addon` (host-native), then compiles for TARGET; the flag reaches
# only the compile step.
vp run build "--target=${TARGET}"

# The app builder keeps the public output at dist/ndea, or dist/ndea.exe when
# targeting Windows (bun appends the suffix). Rename for the matrix.
built="dist/ndea"
case "$TARGET" in
    bun-windows-*) built="dist/ndea.exe" ;;
esac

mv "$built" "dist/${ARTIFACT}"
