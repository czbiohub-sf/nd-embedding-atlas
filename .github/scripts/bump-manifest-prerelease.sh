#!/usr/bin/env bash
# Update the `pre-release` channel pointer in manifest.json to a new tag.
#
# Invoked from release.yml's bump-prerelease-manifest job after publishing
# any pre-release tag (any tag containing `-`, e.g. v0.1.0-alpha.1,
# v0.1.0-beta.2, v0.1.0-rc.1). peter-evans/create-pull-request picks up
# the diff and opens a PR against main.
#
# Required env:
#   NEW_TAG — the pre-release git tag, e.g. v0.1.0-rc.2
set -euo pipefail

: "${NEW_TAG:?NEW_TAG env var is required (pass github.ref_name)}"

# jq is preinstalled on ubuntu-latest runners. The bracket form `."key"`
# is required because the channel name contains a hyphen.
tmp=$(mktemp)
jq --arg tag "${NEW_TAG}" '.channels."pre-release" = $tag' manifest.json > "${tmp}"
mv "${tmp}" manifest.json

echo "Updated manifest.json:"
cat manifest.json
