#!/usr/bin/env bash
# Update the `rc` channel pointer in manifest.json to a new tag.
#
# Invoked from release.yml's bump-rc-manifest job after publishing an
# `*-rc.*` tag. peter-evans/create-pull-request picks up the diff and
# opens a PR against main.
#
# Required env:
#   NEW_TAG — the rc git tag, e.g. v0.1.0-rc.2
set -euo pipefail

: "${NEW_TAG:?NEW_TAG env var is required (pass github.ref_name)}"

# jq is preinstalled on ubuntu-latest runners.
tmp=$(mktemp)
jq --arg tag "${NEW_TAG}" '.channels.rc = $tag' manifest.json > "${tmp}"
mv "${tmp}" manifest.json

echo "Updated manifest.json:"
cat manifest.json
