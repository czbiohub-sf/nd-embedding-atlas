#!/usr/bin/env bash
# Compile the platform-specific ndea binary with embedded frontend assets.
#
# Shared by release.yml + canary.yml. Delegates to scripts/build.ts, which
# (unlike the prior inline approach) embeds dist/frontend/** via a generated
# `import … with { type: "file" }` manifest. Passing binary assets like
# .woff2 to `bun build --compile` directly crashes Bun with
# "Internal error: missing asset file"; the manifest pattern is the
# documented escape hatch.
#
# Required env:
#   TARGET   — bun --target value, e.g. bun-darwin-arm64, bun-linux-x64
#   ARTIFACT — output filename, e.g. ndea-darwin-arm64
set -euo pipefail

: "${TARGET:?TARGET env var is required (bun --target)}"
: "${ARTIFACT:?ARTIFACT env var is required (output filename)}"

mkdir -p dist

# `--skip-frontend` because the workflow already ran `vp build` in a
# preceding step; re-running here would just be slower.
bun run scripts/build.ts "--target=${TARGET}" --skip-frontend

# scripts/build.ts hardcodes outfile=dist/ndea; rename for the matrix.
mv "dist/ndea" "dist/${ARTIFACT}"
