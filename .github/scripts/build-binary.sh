#!/usr/bin/env bash
# Compile the platform-specific ndea binary with embedded frontend assets.
#
# Shared release build helper. Delegates to the app builder, which
# (unlike the prior inline approach) embeds dist/frontend/** via a generated
# `import … with { type: "file" }` manifest. Passing binary assets like
# .woff2 to `bun build --compile` directly crashes Bun with
# "Internal error: missing asset file"; the manifest pattern is the
# documented escape hatch.
#
# Required env:
#   TARGET: bun --target value, e.g. bun-darwin-arm64, bun-linux-x64
#   ARTIFACT: output filename, e.g. ndea-darwin-arm64
set -euo pipefail

: "${TARGET:?TARGET env var is required (bun --target)}"
: "${ARTIFACT:?ARTIFACT env var is required (output filename)}"

mkdir -p dist

# Builds the frontend (Bun.build, in-process ~300ms) and compiles in one
# shot; no separate frontend step needed.
bun run apps/ndea/scripts/build.ts "--target=${TARGET}"

# The app builder keeps the public output at dist/ndea; rename for the matrix.
mv "dist/ndea" "dist/${ARTIFACT}"
