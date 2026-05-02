#!/usr/bin/env bash
# Fail loudly if the pushed git tag does not match package.json's `version`.
# Guards against "tagged without running scripts/sync-version.ts" — the
# binary baked into the release would otherwise report a stale version.
#
# Invoked from .github/workflows/release.yml; expects to run inside a
# checked-out git working tree at a tagged commit.
set -euo pipefail

tag=$(git describe --tags --exact-match)
pkg_version=$(node -p "require('./package.json').version")
expected="v${pkg_version}"

if [[ "${tag}" != "${expected}" ]]; then
    echo "::error::Tag (${tag}) does not match package.json version (${expected})"
    echo "Run 'bun run scripts/sync-version.ts' + commit before tagging."
    exit 1
fi

echo "Tag ${tag} matches package.json ${expected}"
