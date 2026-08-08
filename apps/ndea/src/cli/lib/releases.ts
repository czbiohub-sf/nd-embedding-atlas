/**
 * GitHub Releases resolver and release-asset integrity helpers.
 */

export const REPO = "czbiohub-sf/nd-embedding-atlas";

export const CHANNELS = ["stable", "latest", "pre-release"] as const;

export type Channel = (typeof CHANNELS)[number];

export interface ResolvedAsset {
  tag: string;
  /** Binary download URL for the current platform. */
  assetUrl: string;
  /** Matching `.sha256` download URL. */
  shaUrl: string;
}

export interface Target {
  os: "darwin" | "linux" | "windows";
  arch: "x64" | "arm64";
  /** Asset filename produced by the release workflow. */
  assetName: string;
}

export function detectTarget(): Target {
  const platform = process.platform;
  const arch = process.arch as string;

  let os: Target["os"];
  if (platform === "darwin") os = "darwin";
  else if (platform === "linux") os = "linux";
  else if (platform === "win32") os = "windows";
  else throw new Error(`Unsupported OS: ${platform}`);

  let normalizedArch: Target["arch"];
  if (arch === "x64" || arch === "amd64") normalizedArch = "x64";
  else if (arch === "arm64" || arch === "aarch64") normalizedArch = "arm64";
  else throw new Error(`Unsupported arch: ${arch}`);

  if (os === "darwin" && normalizedArch !== "arm64") {
    throw new Error(`Unsupported release target: ${os}/${normalizedArch}`);
  }
  // Windows publishes x64 only; ARM64 Windows runs it under emulation.
  if (os === "windows" && normalizedArch !== "x64") {
    throw new Error(`Unsupported release target: ${os}/${normalizedArch}`);
  }

  return {
    os,
    arch: normalizedArch,
    assetName: `ndea-${os}-${normalizedArch}${os === "windows" ? ".exe" : ""}`,
  };
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GitHubAsset[];
}

export interface FetchReleaseOptions {
  /** Override `fetch` implementation for callers that need custom transport. */
  fetchImpl?: typeof fetch;
  /** Override platform detection, primarily for tests. */
  target?: Target;
}

const API_ROOT = `https://api.github.com/repos/${REPO}/releases`;
const RELEASE_TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Resolve a channel to the binary and checksum assets published on GitHub.
 *
 * GitHub's latest-release endpoint excludes drafts and prereleases, so
 * `stable` and its `latest` alias share it. The releases endpoint is ordered
 * newest first, so the first eligible pre-release is selected.
 */
export async function fetchRelease(channel: Channel, options: FetchReleaseOptions = {}): Promise<ResolvedAsset> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = channel === "pre-release" ? `${API_ROOT}?per_page=100` : `${API_ROOT}/latest`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub Releases fetch failed (${response.status} ${response.statusText}) at ${url}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`GitHub Releases returned invalid JSON at ${url}`);
  }

  const release =
    channel === "pre-release" ? selectNewestPrerelease(payload) : validateRelease(payload, "latest release");
  assertReleaseTag(release.tag_name);
  const target = options.target ?? detectTarget();
  const checksumName = `${target.assetName}.sha256`;
  const binary = release.assets.find((asset) => asset.name === target.assetName);
  const checksum = release.assets.find((asset) => asset.name === checksumName);

  if (!binary) {
    throw new Error(`GitHub release ${release.tag_name} is missing asset ${target.assetName}`);
  }
  if (!checksum) {
    throw new Error(`GitHub release ${release.tag_name} is missing asset ${checksumName}`);
  }

  return {
    tag: release.tag_name,
    assetUrl: binary.browser_download_url,
    shaUrl: checksum.browser_download_url,
  };
}

function selectNewestPrerelease(payload: unknown): GitHubRelease {
  if (!Array.isArray(payload)) {
    throw new TypeError("GitHub Releases response for pre-release channel is not an array");
  }

  const releases = payload
    .map((value, index) => validateRelease(value, `release at index ${index}`))
    .filter(
      (release) =>
        !release.draft &&
        release.prerelease &&
        release.published_at !== null &&
        Number.isFinite(Date.parse(release.published_at)) &&
        isPrereleaseTag(release.tag_name),
    )
    .toSorted((left, right) => Date.parse(right.published_at as string) - Date.parse(left.published_at as string));

  const release = releases[0];
  if (!release) {
    throw new Error("GitHub Releases response has no published pre-release");
  }
  return release;
}

function assertReleaseTag(tag: string): void {
  if (!isReleaseTag(tag)) {
    throw new Error(`GitHub release has invalid tag_name: ${tag}`);
  }
}

function isPrereleaseTag(tag: string): boolean {
  return isReleaseTag(tag) && tag.split("+", 1)[0].includes("-");
}

function isReleaseTag(tag: string): boolean {
  const match = RELEASE_TAG_PATTERN.exec(tag);
  if (!match) return false;

  const prerelease = match[4];
  if (!prerelease) return true;
  return prerelease
    .split(".")
    .every((identifier) => !/^\d+$/.test(identifier) || identifier === "0" || !identifier.startsWith("0"));
}

function validateRelease(payload: unknown, label: string): GitHubRelease {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`GitHub Releases ${label} is not an object`);
  }

  const release = payload as Record<string, unknown>;
  if (typeof release.tag_name !== "string" || release.tag_name.length === 0) {
    throw new Error(`GitHub Releases ${label} has invalid tag_name`);
  }
  if (typeof release.draft !== "boolean" || typeof release.prerelease !== "boolean") {
    throw new TypeError(`GitHub Releases ${label} has invalid release flags`);
  }
  if (release.published_at !== null && typeof release.published_at !== "string") {
    throw new Error(`GitHub Releases ${label} has invalid published_at`);
  }
  if (!Array.isArray(release.assets)) {
    throw new TypeError(`GitHub Releases ${label} has invalid assets`);
  }

  const assets = release.assets.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`GitHub Releases ${label} has invalid asset at index ${index}`);
    }
    const asset = value as Record<string, unknown>;
    if (
      typeof asset.name !== "string" ||
      asset.name.length === 0 ||
      typeof asset.browser_download_url !== "string" ||
      asset.browser_download_url.length === 0
    ) {
      throw new Error(`GitHub Releases ${label} has invalid asset at index ${index}`);
    }
    return {
      name: asset.name,
      browser_download_url: asset.browser_download_url,
    };
  });

  return {
    tag_name: release.tag_name,
    draft: release.draft,
    prerelease: release.prerelease,
    published_at: release.published_at,
    assets,
  };
}

export function sha256Hex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

export function parseShaFile(body: string): string {
  const trimmed = body.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  const match = /^([a-f0-9]{64})\s/i.exec(trimmed);
  if (match) return match[1].toLowerCase();
  throw new Error(`unrecognised checksum file contents: ${trimmed.slice(0, 80)}`);
}
