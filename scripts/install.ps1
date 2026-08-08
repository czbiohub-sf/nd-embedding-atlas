# ndea installer for Windows: downloads a released binary, verifies its
# SHA-256 checksum, installs it, and puts it on the user PATH.
#
# Layout:
#   %LOCALAPPDATA%\ndea\bin\ndea.exe        : bun-compiled binary
#   %LOCALAPPDATA%\ndea\<version>\duckdb.dll : libduckdb, extracted on first run
#   %USERPROFILE%\.ndea\current-version      : active tag + checksum (diagnostics)
#
# The binary embeds libduckdb; on first launch it extracts a copy to
# %LOCALAPPDATA%\ndea\<version>\duckdb.dll and loads it before any DuckDB code
# runs. No sidecar file, no wrapper script.
#
# Unlike the POSIX installer there is no versions tree and no symlink, because
# `ndea update` is not supported on Windows: re-run this script to move to a
# new release.
#
# Usage:
#   irm https://czbiohub-sf.github.io/nd-embedding-atlas/install.ps1 | iex
#
# `irm | iex` cannot forward arguments. To pick a channel or pin a tag:
#   & ([scriptblock]::Create((irm https://czbiohub-sf.github.io/nd-embedding-atlas/install.ps1))) -Version pre-release
#   & ([scriptblock]::Create((irm https://czbiohub-sf.github.io/nd-embedding-atlas/install.ps1))) -Version v0.1.0
#
# Requires PowerShell 5.1+ (ships with Windows 10/11).

param(
    [string]$Version = "stable"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
# Invoke-WebRequest renders a progress bar that costs more time than the
# download on Windows PowerShell; suppressing it is a large speedup.
$ProgressPreference = "SilentlyContinue"

$Repo = "czbiohub-sf/nd-embedding-atlas"
$Artifact = "ndea-windows-x64.exe"
# `bin` keeps the executable clear of the sibling <version>\ cache dirs the
# binary creates for libduckdb.
$InstallDir = if ($env:NDEA_INSTALL_DIR) { $env:NDEA_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "ndea\bin" }
$StateDir = Join-Path $env:USERPROFILE ".ndea"

# Windows PowerShell 5.1 negotiates TLS 1.0 by default on some hosts, which
# github.com refuses. Opt into TLS 1.2 before any request.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step { param([string]$Message) Write-Host "  -> $Message" }
function Write-Ok { param([string]$Message) Write-Host "  OK $Message" -ForegroundColor Green }
function Write-Die {
    param([string]$Message)
    Write-Host "  ERR $Message" -ForegroundColor Red
    exit 1
}

# Mirrors the tag grammar enforced by scripts/install.sh: v-prefixed SemVer,
# with numeric pre-release identifiers rejected when zero-padded.
function Test-ReleaseTag {
    param([string]$Tag)

    $pattern = '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
    if ($Tag -notmatch $pattern) { return $false }

    if ($Tag -match '-') {
        $prerelease = ($Tag -replace '^[^-]*-', '') -replace '\+.*$', ''
        foreach ($identifier in $prerelease.Split('.')) {
            if ($identifier -match '^[0-9]+$' -and $identifier -match '^0[0-9]') { return $false }
        }
    }
    return $true
}

# --- Elevation guard ------------------------------------------------------
# We install under the user profile. From an elevated shell that resolves to
# the administrator's profile, so the binary lands somewhere the user's own
# shell will never find.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "  WARN running elevated; ndea will install into the administrator profile" -ForegroundColor Yellow
    Write-Host "       ($InstallDir). Re-run from a normal terminal to install for yourself." -ForegroundColor Yellow
}

# --- Release tag resolution -----------------------------------------------
$releaseTag = ""
switch -Regex ($Version) {
    '^(stable|latest)$' {
        Write-Step "Resolving stable channel via GitHub Releases"
        try {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 60
        } catch {
            Write-Die "failed to query GitHub Releases: $($_.Exception.Message)"
        }
        $releaseTag = $release.tag_name
        break
    }
    '^pre-release$' {
        Write-Step "Resolving pre-release channel via GitHub Releases"
        try {
            $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=100" -TimeoutSec 60
        } catch {
            Write-Die "failed to query GitHub Releases: $($_.Exception.Message)"
        }
        foreach ($candidate in $releases) {
            if (-not $candidate.draft -and $candidate.prerelease -and $candidate.published_at -and
                (Test-ReleaseTag $candidate.tag_name)) {
                $releaseTag = $candidate.tag_name
                break
            }
        }
        break
    }
    '^v' {
        $releaseTag = $Version
        break
    }
    default {
        Write-Die "unknown selector '$Version' (expected: stable|latest|pre-release|<tag>)"
    }
}

if (-not $releaseTag) { Write-Die "no published $Version release found on GitHub" }
if (-not (Test-ReleaseTag $releaseTag)) {
    Write-Die "invalid release tag '$releaseTag' (expected v-prefixed SemVer)"
}

# --- Download + verify ----------------------------------------------------
$baseUrl = "https://github.com/$Repo/releases/download/$releaseTag"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("ndea-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    $tmpBin = Join-Path $tmp $Artifact
    $tmpSha = "$tmpBin.sha256"

    Write-Step "Downloading $Artifact ($releaseTag)"
    try {
        Invoke-WebRequest -Uri "$baseUrl/$Artifact" -OutFile $tmpBin -TimeoutSec 900
    } catch {
        Write-Die "cannot download $Artifact for $releaseTag (does that release exist?)"
    }
    try {
        Invoke-WebRequest -Uri "$baseUrl/$Artifact.sha256" -OutFile $tmpSha -TimeoutSec 120
    } catch {
        Write-Die "cannot download $Artifact.sha256 for $releaseTag"
    }

    Write-Step "Verifying $Artifact checksum"
    # Checksum files are `<hex>  <filename>`, written by shasum/sha256sum.
    $expected = ((Get-Content $tmpSha -Raw).Trim() -split '\s+')[0]
    $actual = (Get-FileHash -Path $tmpBin -Algorithm SHA256).Hash
    if ($expected -ine $actual) {
        Write-Die "checksum verification failed - aborting (expected $expected, got $actual)"
    }
    Write-Ok "$Artifact checksum OK"

    # --- Install ----------------------------------------------------------
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $targetBin = Join-Path $InstallDir "ndea.exe"

    # Windows refuses to overwrite a running image. Move the old one aside
    # first: a rename succeeds even while the file is mapped, and the stale
    # copy is swept on the next install.
    Get-ChildItem -Path $InstallDir -Filter "ndea.exe.old-*" -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
    if (Test-Path $targetBin) {
        try {
            Move-Item -Path $targetBin -Destination "$targetBin.old-$(Get-Random)" -Force
        } catch {
            Write-Die "cannot replace $targetBin - close any running ndea and retry"
        }
    }
    Move-Item -Path $tmpBin -Destination $targetBin -Force
    Write-Ok "Installed binary to $targetBin"

    # Record the active version for diagnostics. `ndea doctor` reads the same
    # two-line "<tag>\n<sha256>\n" form the POSIX installer writes.
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    Set-Content -Path (Join-Path $StateDir "current-version") -Value "$releaseTag`n$actual".ToLower() -NoNewline
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# --- PATH -----------------------------------------------------------------
# Read the User scope directly: $env:Path is the merged Machine+User value, so
# testing against it would miss a stale User entry we still need to add.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$onPath = $userPath -and ($userPath.Split(';') -contains $InstallDir)
if (-not $onPath) {
    Write-Step "Adding $InstallDir to your PATH"
    $updated = if ($userPath) { "$($userPath.TrimEnd(';'));$InstallDir" } else { $InstallDir }
    [Environment]::SetEnvironmentVariable("Path", $updated, "User")
    # Make it work in this session too, so the hint below is actionable now.
    $env:Path = "$env:Path;$InstallDir"
    Write-Ok "PATH updated - restart your terminal for it to apply everywhere"
}

Write-Step "Run 'ndea --help' to get started"
