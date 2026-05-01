#!/usr/bin/env bash
# Verify that .bunli/commands.gen.ts is in sync with the source command
# files under src/cli/commands/. The metadata file feeds shell-completion
# generation; if it drifts, `ndea completions <shell>` ships stale flag
# names and missing commands.
#
# Standard "verify-no-drift" / "gen-check" pattern: regenerate, then
# `git diff --exit-code` to fail with the diff if anything changed.
#
# Run locally with:  bun run gen   (regenerate + commit)
set -euo pipefail

bunx bunli generate

if ! git diff --exit-code -- .bunli/; then
    echo
    echo "::error::.bunli/commands.gen.ts is stale."
    echo "Run 'bun run gen' locally and commit the result."
    exit 1
fi

echo "OK .bunli/commands.gen.ts matches the source command surface."
