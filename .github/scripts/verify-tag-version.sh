#!/usr/bin/env bash
# Fail loudly if the pushed git tag does not match the app package version.
# Guards against tagging without running the app sync-version task — the
# binary baked into the release would otherwise report a stale version.
#
# Invoked from .github/workflows/release.yml; expects to run inside a
# checked-out git working tree at a tagged commit.
set -euo pipefail

tag=$(git describe --tags --exact-match)
pkg_version=$(bun -p "require('./apps/ndea/package.json').version")
expected="v${pkg_version}"

if [[ "${tag}" != "${expected}" ]]; then
    echo "::error::Tag (${tag}) does not match apps/ndea/package.json version (${expected})"
    echo "Run 'vp run sync-version' and commit before tagging."
    exit 1
fi

echo "Tag ${tag} matches apps/ndea/package.json ${expected}"
