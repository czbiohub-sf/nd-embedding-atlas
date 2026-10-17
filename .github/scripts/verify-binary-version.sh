#!/usr/bin/env bash
set -euo pipefail

: "${ARTIFACT:?ARTIFACT env var is required}"

expected=${EXPECTED_VERSION:-$(bun -p "require('./apps/ndea/package.json').version")}
actual=$("./dist/${ARTIFACT}" --version)

if [[ -z "$actual" ]]; then
    echo "::error::dist/${ARTIFACT} printed no version"
    exit 1
fi

if [[ "$actual" != "$expected" ]]; then
    echo "::error::dist/${ARTIFACT} reports ${actual}; expected ${expected}"
    exit 1
fi

echo "dist/${ARTIFACT} reports expected version ${expected}"
