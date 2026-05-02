#!/usr/bin/env bash
# Atomically replace the rolling `canary` GitHub Release.
#
# Delete + recreate (rather than upload over) so stale assets from prior
# canary builds don't linger. `--cleanup-tag` removes the underlying git
# tag too; `create --target $GITHUB_SHA` recreates it pointing at the
# freshly-pushed main commit.
#
# Required env:
#   GH_TOKEN     — for gh CLI auth (workflow passes ${{ github.token }})
#   GITHUB_SHA   — set by the runner; the commit canary targets
#   GITHUB_REPOSITORY — set by the runner; e.g. czbiohub-sf/nd-embedding-atlas
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN env var is required (pass via env: GH_TOKEN: \${{ github.token }})}"
: "${GITHUB_SHA:?GITHUB_SHA env var is required (set automatically by GitHub runners)}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY env var is required (set automatically by GitHub runners)}"

short_sha=$(git rev-parse --short HEAD)

# Idempotent: prior canary tag/release may not exist on the very first run.
gh release delete canary --yes --cleanup-tag 2>/dev/null || true

notes=$(cat <<EOF
Bleeding-edge build from \`main\` at ${short_sha}.

## Install

\`\`\`bash
NDEA_CHANNEL=canary curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/main/scripts/install.sh | sh
\`\`\`

## Upgrade in place

\`\`\`bash
ndea update --channel canary
\`\`\`

## Roll back

\`\`\`bash
ndea rollback
\`\`\`

> Canary builds are unsigned and rebuilt on every push to \`main\`.
> Expect breakage; report issues at https://github.com/${GITHUB_REPOSITORY}/issues.
EOF
)

gh release create canary \
    --target "${GITHUB_SHA}" \
    --title "Canary (build ${short_sha})" \
    --prerelease \
    --notes "${notes}" \
    dist/*
