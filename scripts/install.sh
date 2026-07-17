#!/usr/bin/env sh
# ndea installer — downloads a released binary, verifies its SHA-256
# checksum, places it in the versions tree, and creates a symlink on PATH.
#
# Layout:
#   $NDEA_HOME/versions/<tag>/ndea               — bun-compiled binary
#   $NDEA_BIN_DIR/ndea                           — symlink → versions/<tag>/ndea
#
# The binary embeds libduckdb; on first launch it extracts a copy to
# ~/.cache/ndea/<tag>/libduckdb.<ext> and dlopens it before any DuckDB
# code runs. No sidecar file, no wrapper script.
#
# `ndea update` uses the same layout, so installs and updates share one
# atomic-symlink-swap mechanism. Old versions stay on disk for `ndea rollback`.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/czbiohub-sf/nd-embedding-atlas/main/scripts/install.sh | sh
#
# Environment variables:
#   NDEA_VERSION         release tag to install (default: latest)
#   NDEA_BIN_DIR         PATH directory holding the symlink (default: $HOME/.local/bin)
#   NDEA_HOME            state root for versions/ + locks/ (default: $HOME/.ndea)
#   NDEA_CHANNEL         release channel: stable | latest | pre-release (default: stable)
#                        - stable: most recent semver-tagged release
#                        - pre-release: latest active alpha / beta / rc (resolved via manifest.json)
#   NDEA_GITHUB_TOKEN    GitHub token for private/internal repos. Falls back to
#                        GITHUB_TOKEN if unset. When present, downloads go via
#                        the GitHub Releases API (Accept: application/octet-stream)
#                        so private-repo asset URLs resolve. Get a token via
#                        \`gh auth token\` if you have the gh CLI.
#
# POSIX sh — no bashisms. Tested with dash, bash 3.2, bash 5.x, zsh.

set -euf

REPO="czbiohub-sf/nd-embedding-atlas"
VERSION="${NDEA_VERSION:-latest}"
CHANNEL="${NDEA_CHANNEL:-stable}"
DEST="${NDEA_BIN_DIR:-$HOME/.local/bin}"
NDEA_HOME_DIR="${NDEA_HOME:-$HOME/.ndea}"

case "$CHANNEL" in
    stable | latest | pre-release) ;;
    *)
        printf '  \033[31mERR\033[0m unknown NDEA_CHANNEL=%s (expected: stable|latest|pre-release)\n' "$CHANNEL" >&2
        exit 1
        ;;
esac

log() { printf '  \033[1m%s\033[0m %s\n' "->" "$*" >&2; }
ok() { printf '  \033[32mOK\033[0m %s\n' "$*" >&2; }
die() {
    printf '  \033[31mERR\033[0m %s\n' "$*" >&2
    exit 1
}

# --- Dependency checks ----------------------------------------------------
command -v curl >/dev/null 2>&1 || die "curl is required"

# --- Auth + API helpers ---------------------------------------------------
# When the repo is private/internal, anonymous downloads return 404 even
# for the standard \`releases/download\` URL. The fix is to authenticate
# and use the API endpoint with \`Accept: application/octet-stream\` so
# the response is the binary, not JSON metadata.
TOKEN="${NDEA_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"

# Curl wrapper: adds bearer auth when a token is present, otherwise
# behaves like plain anonymous curl. Single source of truth for the
# common flags too.
gh_curl() {
    if [ -n "$TOKEN" ]; then
        curl -fsSL --proto '=https' --tlsv1.2 -H "Authorization: Bearer $TOKEN" "$@"
    else
        curl -fsSL --proto '=https' --tlsv1.2 "$@"
    fi
}

# Look up an asset's numeric ID by name within a release. POSIX-ish — uses
# only awk + curl. Works on BusyBox awk (Alpine) and gawk (Debian/Ubuntu).
# Args: $1 = release tag (e.g. v0.1.0), $2 = asset name (e.g. ndea-linux-x64)
resolve_asset_id() {
    release_tag=$1
    asset_name=$2
    api_url="https://api.github.com/repos/${REPO}/releases/tags/${release_tag}"
    # Buffer the full response before piping to awk. awk `exit`s on the first
    # matching asset, which would close the pipe mid-stream and leave curl
    # writing into a dead reader → `curl: (23) Failed writing body`. Draining
    # into a variable first means curl finishes cleanly regardless of when awk
    # stops reading.
    release_json=$(gh_curl "$api_url")
    printf '%s\n' "$release_json" |
        awk -v target="$asset_name" '
            /"id":[[:space:]]*[0-9]+/ {
                last_id = $0
                sub(/.*"id":[[:space:]]*/, "", last_id)
                sub(/[^0-9].*/, "", last_id)
            }
            /"name":[[:space:]]*"/ {
                line = $0
                sub(/.*"name":[[:space:]]*"/, "", line)
                sub(/".*/, "", line)
                if (line == target) { print last_id; exit }
            }
        '
}

# Download a release asset to a local path. Picks the right URL/headers
# based on whether we have a token (private-repo path vs public path).
# Args: $1 = release tag, $2 = asset name, $3 = output path
download_asset() {
    release_tag=$1
    asset_name=$2
    out=$3
    if [ -n "$TOKEN" ]; then
        asset_id=$(resolve_asset_id "$release_tag" "$asset_name")
        [ -n "$asset_id" ] || die "asset ${asset_name} not found in release ${release_tag} (token issue or wrong tag?)"
        gh_curl -H "Accept: application/octet-stream" \
            -o "$out" \
            "https://api.github.com/repos/${REPO}/releases/assets/${asset_id}"
    else
        url="https://github.com/${REPO}/releases/download/${release_tag}/${asset_name}"
        gh_curl -o "$out" "$url" ||
            die "failed to download ${url} (private repo? set NDEA_GITHUB_TOKEN)"
    fi
}

if command -v sha256sum >/dev/null 2>&1; then
    sha_verify() { sha256sum -c "$1"; }
elif command -v shasum >/dev/null 2>&1; then
    sha_verify() { shasum -a 256 -c "$1"; }
else
    die "neither sha256sum nor shasum found - cannot verify checksum"
fi

# --- Platform detection ---------------------------------------------------
os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in
    darwin | linux) ;;
    *) die "unsupported OS: $os (install manually: https://github.com/${REPO}/releases)" ;;
esac

arch=$(uname -m)
case "$arch" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) die "unsupported arch: $arch (install manually: https://github.com/${REPO}/releases)" ;;
esac

artifact="ndea-${os}-${arch}"

# --- Release tag resolution ---------------------------------------------
# Resolve channel + version into the concrete tag we want assets from.
# pre-release → resolved via manifest.json's `channels.pre-release` pointer.
# latest → resolved via the `releases/latest` redirect (or API when authed).
manifest_url="https://raw.githubusercontent.com/${REPO}/main/manifest.json"

if [ "$CHANNEL" = "pre-release" ]; then
    log "Resolving pre-release channel via manifest.json"
    release_tag=$(gh_curl "$manifest_url" |
        sed -n 's/.*"pre-release"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
        head -n 1)
    [ -n "$release_tag" ] || die "no active pre-release in manifest (channels.pre-release is null)"
elif [ "$VERSION" = "latest" ]; then
    if [ -n "$TOKEN" ]; then
        release_tag=$(gh_curl "https://api.github.com/repos/${REPO}/releases/latest" |
            sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
            head -n 1)
        [ -n "$release_tag" ] || die "could not resolve latest release tag via API"
    else
        # Anonymous: follow the redirect on the public latest URL.
        release_tag=$(curl -fsSLo /dev/null -w '%{url_effective}' --proto '=https' --tlsv1.2 \
            "https://github.com/${REPO}/releases/latest" 2>/dev/null |
            sed -n 's|.*/releases/tag/\([^/?#]*\).*|\1|p')
        [ -n "$release_tag" ] || die "could not resolve latest release tag"
    fi
else
    release_tag="$VERSION"
fi
VERSION="$release_tag"

# --- Tmp workspace with guaranteed cleanup --------------------------------
tmp=$(mktemp -d 2>/dev/null || mktemp -d -t ndea)
trap 'rm -rf "$tmp"' EXIT INT TERM HUP

# --- Download + verify ----------------------------------------------------
log "Downloading $artifact ($VERSION)"
download_asset "$release_tag" "$artifact" "$tmp/$artifact"
download_asset "$release_tag" "$artifact.sha256" "$tmp/$artifact.sha256"

log "Verifying $artifact checksum"
(cd "$tmp" && sha_verify "$artifact.sha256" >/dev/null) ||
    die "checksum verification failed - aborting"
ok "$artifact checksum OK"

# --- Install --------------------------------------------------------------
# release_tag was resolved above (latest → real tag, pre-release → manifest
# pointer, otherwise the user-supplied tag). Use
# it directly as the versions/ subdir name.
versions_dir="$NDEA_HOME_DIR/versions/$release_tag"
target_bin="$versions_dir/ndea"

mkdir -p "$versions_dir" || die "cannot create $versions_dir"
mkdir -p "$DEST" || die "cannot create $DEST"

chmod +x "$tmp/$artifact"
mv "$tmp/$artifact" "$target_bin" || die "cannot write $target_bin (permission?)"
ok "Installed binary to $target_bin"

# Atomic symlink swap: write to a sibling tmp name and rename(2) over the
# live link. POSIX rename is atomic for both files and symlinks; the swap
# survives a crash of this script with no torn state.
link="$DEST/ndea"
tmp_link="${link}.tmp"
rm -f "$tmp_link"
ln -s "$target_bin" "$tmp_link" || die "cannot create symlink at $tmp_link"
mv -f "$tmp_link" "$link" || die "cannot move symlink into place at $link"
ok "Linked $link → $target_bin"

# Record the active version for `ndea --version` / diagnostics.
mkdir -p "$NDEA_HOME_DIR"
printf '%s\n' "$release_tag" >"$NDEA_HOME_DIR/current-version" 2>/dev/null || true

# --- PATH guidance (shell-aware) ------------------------------------------
case ":$PATH:" in
    *":$DEST:"*) ;;
    *)
        shell_name=$(basename "${SHELL:-/bin/sh}")
        case "$shell_name" in
            zsh) rc="$HOME/.zshrc" ;;
            bash) rc="$HOME/.bashrc" ;;
            fish) rc="$HOME/.config/fish/config.fish" ;;
            *) rc="your shell rc" ;;
        esac
        log "$DEST is not on PATH - add it to $rc:"
        if [ "$shell_name" = "fish" ]; then
            printf '\n    fish_add_path "%s"\n\n' "$DEST" >&2
        else
            # shellcheck disable=SC2016  # $PATH is meant to be literal in the printed snippet
            printf '\n    export PATH="%s:$PATH"\n\n' "$DEST" >&2
        fi
        ;;
esac

log "Run 'ndea --help' to get started"
