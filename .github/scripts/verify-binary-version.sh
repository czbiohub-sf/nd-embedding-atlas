#!/usr/bin/env bash
set -euo pipefail

: "${ARTIFACT:?ARTIFACT env var is required}"

expected=${EXPECTED_VERSION:-$(bun -p "require('./apps/ndea/package.json').version")}
output=$("./dist/${ARTIFACT}" --version)
actual=$(printf '%s\n' "$output" | sed -n 's/.*"version": "\([^"]*\)".*/\1/p')

if [[ -z "$actual" ]]; then
    echo "::error::Could not parse version from dist/${ARTIFACT} output"
    printf '%s\n' "$output"
    exit 1
fi

if [[ "$actual" != "$expected" ]]; then
    echo "::error::dist/${ARTIFACT} reports ${actual}; expected ${expected}"
    exit 1
fi

echo "dist/${ARTIFACT} reports expected version ${expected}"
