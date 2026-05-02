#!/usr/bin/env sh
# ndea installer — downloads a released binary, verifies its SHA-256
# checksum, places it in the versions tree, and creates a symlink on PATH.
#
# Layout:
#   $NDEA_HOME/versions/<tag>/ndea     — installed binary (one per version)
#   $NDEA_BIN_DIR/ndea                 — symlink to active versions/<tag>/ndea
#
# `ndea update` uses the same layout, so installs and updates share one
# atomic-symlink-swap mechanism. Old versions stay on disk for `ndea rollback`.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/czbiohub-sf/nd-embedding-atlas/main/scripts/install.sh | sh
#
# Environment variables:
#   NDEA_VERSION   release tag to install (default: latest)
#   NDEA_BIN_DIR   PATH directory holding the symlink (default: $HOME/.local/bin)
#   NDEA_HOME      state root for versions/ + locks/ (default: $HOME/.ndea)
#   NDEA_CHANNEL   release channel: stable | pre-release | canary (default: stable)
#                  - stable: most recent semver-tagged release
#                  - pre-release: latest active alpha / beta / rc (resolved via manifest.json)
#                  - canary: rolling pre-release built from `main` on every push
#
# POSIX sh — no bashisms. Tested with dash, bash 3.2, bash 5.x, zsh.

set -euf

REPO="czbiohub-sf/nd-embedding-atlas"
VERSION="${NDEA_VERSION:-latest}"
CHANNEL="${NDEA_CHANNEL:-stable}"
DEST="${NDEA_BIN_DIR:-$HOME/.local/bin}"
NDEA_HOME_DIR="${NDEA_HOME:-$HOME/.ndea}"

case "$CHANNEL" in
    stable | latest | pre-release | canary) ;;
    *) printf '  \033[31mERR\033[0m unknown NDEA_CHANNEL=%s (expected: stable|pre-release|canary)\n' "$CHANNEL" >&2; exit 1 ;;
esac

log() { printf '  \033[1m%s\033[0m %s\n' "->" "$*" >&2; }
ok()  { printf '  \033[32mOK\033[0m %s\n' "$*" >&2; }
die() { printf '  \033[31mERR\033[0m %s\n' "$*" >&2; exit 1; }

# --- Dependency checks ----------------------------------------------------
command -v curl >/dev/null 2>&1 || die "curl is required"

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

# --- Release URL ----------------------------------------------------------
# Channel takes precedence over NDEA_VERSION when set to `canary` or
# `pre-release` — those map to a rolling or manifest-resolved tag, so a
# fixed version doesn't apply.
base="https://github.com/${REPO}/releases"
manifest_url="https://raw.githubusercontent.com/${REPO}/main/manifest.json"

if [ "$CHANNEL" = "canary" ]; then
    bin_url="${base}/download/canary/${artifact}"
    sha_url="${base}/download/canary/${artifact}.sha256"
elif [ "$CHANNEL" = "pre-release" ]; then
    log "Resolving pre-release channel via manifest.json"
    pre_tag=$(curl -fsSL --proto '=https' --tlsv1.2 "$manifest_url" \
        | sed -n 's/.*"pre-release"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        | head -n 1)
    [ -n "$pre_tag" ] || die "no active pre-release in manifest (channels.pre-release is null)"
    bin_url="${base}/download/${pre_tag}/${artifact}"
    sha_url="${base}/download/${pre_tag}/${artifact}.sha256"
    VERSION="$pre_tag"
elif [ "$VERSION" = "latest" ]; then
    bin_url="${base}/latest/download/${artifact}"
    sha_url="${base}/latest/download/${artifact}.sha256"
else
    bin_url="${base}/download/${VERSION}/${artifact}"
    sha_url="${base}/download/${VERSION}/${artifact}.sha256"
fi

# --- Tmp workspace with guaranteed cleanup --------------------------------
tmp=$(mktemp -d 2>/dev/null || mktemp -d -t ndea)
trap 'rm -rf "$tmp"' EXIT INT TERM HUP

# --- Download + verify ----------------------------------------------------
if [ "$CHANNEL" = "canary" ]; then
    log "Downloading $artifact (canary — rolling pre-release)"
else
    log "Downloading $artifact ($VERSION)"
fi
curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/$artifact" "$bin_url" \
    || die "failed to download $bin_url"
curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/$artifact.sha256" "$sha_url" \
    || die "failed to download checksum (release may be missing $artifact.sha256)"

log "Verifying checksum"
(cd "$tmp" && sha_verify "$artifact.sha256" >/dev/null) \
    || die "checksum verification failed - aborting"
ok "checksum OK"

# --- Install --------------------------------------------------------------
# Resolve version tag for the versions directory. `latest` and `canary`
# don't have a deterministic tag at this point in the script — we read
# the GitHub redirect / use the channel name as the directory name.
case "$VERSION" in
    latest)
        # Resolve `latest` to its actual tag by following the release redirect.
        # `curl -sLo /dev/null -w '%{url_effective}'` returns the final URL,
        # which contains the resolved tag in /releases/tag/<tag>.
        resolved=$(curl -fsSLo /dev/null -w '%{url_effective}' --proto '=https' --tlsv1.2 \
            "https://github.com/${REPO}/releases/latest" 2>/dev/null \
            | sed -n 's|.*/releases/tag/\([^/?#]*\).*|\1|p')
        version_tag="${resolved:-$VERSION}"
        ;;
    *)
        version_tag="$VERSION"
        ;;
esac
[ "$CHANNEL" = "canary" ] && version_tag="canary"

versions_dir="$NDEA_HOME_DIR/versions/$version_tag"
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
printf '%s\n' "$version_tag" > "$NDEA_HOME_DIR/current-version" 2>/dev/null || true

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
