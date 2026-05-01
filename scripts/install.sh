#!/usr/bin/env sh
# ndea installer — downloads a released binary, verifies its SHA-256
# checksum, and drops it into $NDEA_BIN_DIR (default: $HOME/.local/bin).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/czbiohub-sf/nd-embedding-atlas/main/scripts/install.sh | sh
#
# Environment variables:
#   NDEA_VERSION   release tag to install (default: latest)
#   NDEA_BIN_DIR   install destination   (default: $HOME/.local/bin)
#   NDEA_CHANNEL   release channel: stable | canary (default: stable)
#                  - stable: most recent semver-tagged release
#                  - canary: rolling pre-release built from `main` on every push
#
# POSIX sh — no bashisms. Tested with dash, bash 3.2, bash 5.x, zsh.

set -euf

REPO="czbiohub-sf/nd-embedding-atlas"
VERSION="${NDEA_VERSION:-latest}"
CHANNEL="${NDEA_CHANNEL:-stable}"
DEST="${NDEA_BIN_DIR:-$HOME/.local/bin}"

case "$CHANNEL" in
    stable | latest | canary) ;;
    *) printf '  \033[31mERR\033[0m unknown NDEA_CHANNEL=%s (expected: stable|canary)\n' "$CHANNEL" >&2; exit 1 ;;
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
# Channel takes precedence over NDEA_VERSION when set to `canary` — the canary
# release is a rolling tag rewritten on every push to `main`, so a fixed
# version doesn't apply.
base="https://github.com/${REPO}/releases"
if [ "$CHANNEL" = "canary" ]; then
    bin_url="${base}/download/canary/${artifact}"
    sha_url="${base}/download/canary/${artifact}.sha256"
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
mkdir -p "$DEST" || die "cannot create $DEST"
if [ -e "$DEST/ndea" ]; then
    log "Existing ndea at $DEST/ndea will be replaced"
fi
chmod +x "$tmp/$artifact"
mv "$tmp/$artifact" "$DEST/ndea" || die "cannot write $DEST/ndea (permission?)"
ok "Installed ndea to $DEST/ndea"

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
