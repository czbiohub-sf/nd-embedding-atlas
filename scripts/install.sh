#!/usr/bin/env sh
# ndea installer: downloads a released binary, verifies its SHA-256
# checksum, places it in the versions tree, and creates a symlink on PATH.
#
# Layout:
#   $HOME/.ndea/versions/<tag>/ndea             : bun-compiled binary
#   $HOME/.local/bin/ndea                       : symlink → versions/<tag>/ndea
#
# The binary embeds libduckdb; on first launch it extracts a copy to
# ~/.cache/ndea/<version>/libduckdb.<ext> and dlopens it before any DuckDB
# code runs. No sidecar file, no wrapper script.
#
# `ndea update` uses the same layout, so installs and updates share one
# atomic-symlink-swap mechanism.
#
# Usage:
#   curl -fsSL https://czbiohub-sf.github.io/nd-embedding-atlas/install.sh | sh
#   curl -fsSL https://czbiohub-sf.github.io/nd-embedding-atlas/install.sh | sh -s -- v0.1.0
#   curl -fsSL https://czbiohub-sf.github.io/nd-embedding-atlas/install.sh | sh -s -- pre-release
#
# POSIX sh: no bashisms. Tested with dash, bash 3.2, bash 5.x, zsh.

set -euf

REPO="czbiohub-sf/nd-embedding-atlas"
DEST="$HOME/.local/bin"
STATE_DIR="$HOME/.ndea"

log() { printf '  \033[1m%s\033[0m %s\n' "->" "$*" >&2; }
ok() { printf '  \033[32mOK\033[0m %s\n' "$*" >&2; }
die() {
    printf '  \033[31mERR\033[0m %s\n' "$*" >&2
    exit 1
}

is_release_tag() (
    tag=$1
    printf '%s\n' "$tag" |
        grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?([+][0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$' ||
        return 1

    case "$tag" in
        *-*)
            prerelease=${tag#*-}
            prerelease=${prerelease%%+*}
            old_ifs=$IFS
            IFS=.
            # shellcheck disable=SC2086  # intentional IFS split; validated tag has no glob metacharacters
            set -- $prerelease
            IFS=$old_ifs
            for identifier do
                case "$identifier" in
                    0 | *[!0-9]*) ;;
                    0*) return 1 ;;
                esac
            done
            ;;
    esac
)

# A canary tag names `canary` in its SemVer pre-release segment. Build
# metadata carries no precedence under SemVer, so `v1.0.0-rc.1+canary` is an
# ordinary rc. Mirrors `isCanaryTag` in apps/ndea/src/cli/lib/releases.ts;
# change the two together.
is_canary_tag() (
    tag=${1%%+*}
    case "$tag" in
        *-*) ;;
        *) return 1 ;;
    esac
    case "${tag#*-}" in
        *[Cc][Aa][Nn][Aa][Rr][Yy]*) return 0 ;;
        *) return 1 ;;
    esac
)

usage() {
    cat >&2 <<'EOF'
Install ndea.

Usage: install.sh [stable|latest|pre-release|<tag>]

  stable       active stable release (default)
  latest       alias for stable
  pre-release  active alpha / beta / rc
  <tag>        an explicit release tag, e.g. v0.1.0

EOF
}

# --- Arguments ------------------------------------------------------------
# One optional positional selector. Channels resolve through GitHub Releases;
# an explicit v-prefixed tag installs that release directly.
[ "$#" -le 1 ] || die "too many arguments (expected at most one selector)"

channel=""
release_tag=""
selector="${1:-stable}"
case "$selector" in
    -h | --help)
        usage
        exit 0
        ;;
    stable | latest | pre-release) channel="$selector" ;;
    v*) release_tag="$selector" ;;
    *) die "unknown selector '$selector' (expected: stable|latest|pre-release|<tag>)" ;;
esac

# --- Sudo guard -----------------------------------------------------------
# We install under $HOME. Under sudo that resolves to root's home, so the
# binary lands somewhere the user's own shell will never find. Plain root
# with no sudo (containers, CI) is unaffected by this check.
if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    printf '  \033[31mERR\033[0m do not run this installer with sudo.\n\n' >&2
    printf '  ndea installs into your home directory and does not need root.\n' >&2
    printf '  Under sudo it would install into root'"'"'s home instead of yours,\n' >&2
    printf '  and the '"'"'ndea'"'"' command would not work from your own shell.\n\n' >&2
    printf '  Re-run the same command without sudo.\n' >&2
    exit 1
fi

# --- Downloader -----------------------------------------------------------
# curl preferred, wget as fallback so the script runs on minimal images.
if command -v curl >/dev/null 2>&1; then
    fetch() { curl -fsSL --proto '=https' --tlsv1.2 "$1"; }
    download() { curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
    fetch() { wget -qO- "$1"; }
    download() { wget -qO "$2" "$1"; }
else
    die "curl or wget is required"
fi

if command -v sha256sum >/dev/null 2>&1; then
    sha_verify() { sha256sum -c "$1"; }
elif command -v shasum >/dev/null 2>&1; then
    sha_verify() { shasum -a 256 -c "$1"; }
else
    die "neither sha256sum nor shasum found - cannot verify checksum"
fi

# --- Platform detection ---------------------------------------------------
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$arch" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
esac

case "$os/$arch" in
    darwin/arm64 | linux/x64 | linux/arm64) ;;
    *) die "unsupported platform: $os/$arch (supported: darwin/arm64, linux/x64, linux/arm64)" ;;
esac

artifact="ndea-${os}-${arch}"

# --- Release tag resolution -----------------------------------------------
# Stable/latest use GitHub's canonical latest-release endpoint. Pre-release
# scans the ordered releases response for the newest published, non-draft
# semver pre-release. Parsing stays POSIX-only; jq is not required.
if [ -z "$release_tag" ]; then
    log "Resolving $channel channel via GitHub Releases"
    case "$channel" in
        stable | latest)
            releases_url="https://api.github.com/repos/${REPO}/releases/latest"
            release_json=$(fetch "$releases_url") || die "failed to query GitHub Releases at $releases_url"
            release_tag=$(printf '%s\n' "$release_json" |
                awk '
                    match($0, /"tag_name"[[:space:]]*:[[:space:]]*"/) {
                        value = substr($0, RSTART + RLENGTH)
                        sub(/".*/, "", value)
                        print value
                        exit
                    }
                ')
            ;;
        pre-release)
            releases_url="https://api.github.com/repos/${REPO}/releases?per_page=100"
            release_json=$(fetch "$releases_url") || die "failed to query GitHub Releases at $releases_url"
            release_candidates=$(printf '%s\n' "$release_json" |
                awk '
                    function inspect(line) {
                        if (line ~ /"draft"[[:space:]]*:[[:space:]]*false/) {
                            draft_ok = 1
                        }
                        if (line ~ /"prerelease"[[:space:]]*:[[:space:]]*true/) {
                            prerelease_ok = 1
                        }
                        if (line ~ /"published_at"[[:space:]]*:[[:space:]]*"[^"]+"/) {
                            published_ok = 1
                        }
                        if (tag != "" && draft_ok && prerelease_ok && published_ok) {
                            print tag
                            tag = ""
                        }
                    }
                    {
                        marker = "\"tag_name\"[[:space:]]*:[[:space:]]*\""
                        line = $0
                        while (match(line, marker)) {
                            before = substr(line, 1, RSTART - 1)
                            if (tag ~ /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*([+][0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/) {
                                inspect(before)
                            } else {
                                tag = ""
                            }
                            value = substr(line, RSTART + RLENGTH)
                            tag = value
                            sub(/".*/, "", tag)
                            draft_ok = 0
                            prerelease_ok = 0
                            published_ok = 0
                            line = substr(value, length(tag) + 2)
                        }
                        if (tag ~ /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*([+][0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/) {
                            inspect(line)
                        } else {
                            tag = ""
                        }
                    }
                ')
            for candidate in $release_candidates; do
                if is_canary_tag "$candidate"; then
                    continue
                fi
                if is_release_tag "$candidate"; then
                    release_tag=$candidate
                    break
                fi
            done
            ;;
    esac
    [ -n "$release_tag" ] || die "no published $channel release found on GitHub"
fi
is_release_tag "$release_tag" || die "invalid release tag '$release_tag' (expected v-prefixed SemVer)"

# --- Tmp workspace with guaranteed cleanup --------------------------------
tmp=$(mktemp -d 2>/dev/null || mktemp -d -t ndea)
tmp_bin=""
lock_path="$STATE_DIR/locks/install.lock"
lock_claim="${lock_path}.$$"
lock_held=0
cleanup() {
    rm -rf "$tmp"
    [ -z "$tmp_bin" ] || rm -f "$tmp_bin"
    # Drop the lock only if it is still ours. The claim file holds this PID and
    # the lock is a hard link to it, so matching contents means matching owner.
    # (`test -ef` would say this more directly but is not in POSIX test.)
    if [ "$lock_held" -eq 1 ] && [ "$(cat "$lock_path" 2>/dev/null || true)" = "$$" ]; then
        rm -f "$lock_path"
    fi
    rm -f "$lock_claim"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# --- Download + verify ----------------------------------------------------
base_url="https://github.com/${REPO}/releases/download/${release_tag}"

log "Downloading $artifact ($release_tag)"
download "$base_url/$artifact" "$tmp/$artifact" ||
    die "cannot download $artifact for $release_tag (does that release exist?)"
download "$base_url/$artifact.sha256" "$tmp/$artifact.sha256" ||
    die "cannot download $artifact.sha256 for $release_tag"

log "Verifying $artifact checksum"
(cd "$tmp" && sha_verify "$artifact.sha256" >/dev/null) ||
    die "checksum verification failed - aborting"
ok "$artifact checksum OK"

# --- Install --------------------------------------------------------------
versions_dir="$STATE_DIR/versions/$release_tag"
target_bin="$versions_dir/ndea"

mkdir -p "$STATE_DIR/locks" || die "cannot create $STATE_DIR/locks"
printf '%s\n' "$$" >"$lock_claim" || die "cannot create install lock claim"
if ! ln "$lock_claim" "$lock_path" 2>/dev/null; then
    lock_pid=$(cat "$lock_path" 2>/dev/null || true)
    case "$lock_pid" in
        '' | *[!0-9]*) ;;
        *)
            if kill -0 "$lock_pid" 2>/dev/null; then
                die "install/update lock held by PID $lock_pid ($lock_path)"
            fi
            ;;
    esac
    rm -f "$lock_path"
    ln "$lock_claim" "$lock_path" 2>/dev/null || die "cannot acquire install/update lock at $lock_path"
fi
lock_held=1

mkdir -p "$versions_dir" || die "cannot create $versions_dir"
mkdir -p "$DEST" || die "cannot create $DEST"

tmp_bin="${target_bin}.tmp.$$"
rm -f "$tmp_bin"
cp "$tmp/$artifact" "$tmp_bin" || die "cannot stage binary at $tmp_bin"
chmod +x "$tmp_bin"
mv -f "$tmp_bin" "$target_bin" || die "cannot install binary at $target_bin"
tmp_bin=""
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

# Record the active version for `ndea --version` / diagnostics. `ndea update`
# writes the same two-line "<tag>\n<sha256>\n" form.
checksum=$(cut -d' ' -f1 <"$tmp/$artifact.sha256")
printf '%s\n%s\n' "$release_tag" "$checksum" >"$STATE_DIR/current-version" 2>/dev/null || true

rm -f "$lock_path" "$lock_claim"
lock_held=0

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
