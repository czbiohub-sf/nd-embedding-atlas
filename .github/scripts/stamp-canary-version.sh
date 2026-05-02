#!/usr/bin/env bash
# Stamp `src/cli/version.ts` with `<pkg.version>-canary.<short-sha>`.
#
# Each canary commit produces a unique version string so `ndea update
# --channel canary` correctly sees a new version (the equality check
# against the staged version would otherwise short-circuit on identical
# package.json versions across commits).
#
# Convention: `0.1.0-canary.abc1234`, semver-compatible.
#
# Invoked from .github/workflows/canary.yml; runs inside a checked-out
# git working tree at HEAD of main.
set -euo pipefail

short_sha=$(git rev-parse --short HEAD)
pkg_version=$(node -p "require('./package.json').version")
canary_version="${pkg_version}-canary.${short_sha}"

printf 'export const VERSION = "%s";\n' "${canary_version}" > src/cli/version.ts
echo "Built canary version: ${canary_version}"
