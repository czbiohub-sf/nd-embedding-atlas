/**
 * Manifest fetcher — resolves release channel → GitHub release asset URLs.
 *
 * The manifest lives at a stable URL (repo root on `main`) so install.sh and
 * `ndea update` can share the same "what should I install?" answer. Shape:
 *
 *     { "channels": { "stable": "v0.2.0", "latest": "v0.3.0-rc1" } }
 *
 * Ops can hand-edit to roll back "stable" without re-tagging.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

export const REPO = "czbiohub-sf/nd-embedding-atlas";

/** Canonical manifest location — served via GitHub's raw CDN. */
export const MANIFEST_URL = `https://raw.githubusercontent.com/${REPO}/main/manifest.json`;

/** Supported release channels. */
export const CHANNELS = ["stable", "latest", "canary"] as const;

export type Channel = (typeof CHANNELS)[number];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Manifest {
  channels: Partial<Record<Channel, string>>;
}

export interface ResolvedAsset {
  tag: string;
  /** Binary download URL (the platform-appropriate `ndea-<os>-<arch>[.exe]`). */
  assetUrl: string;
  /** Matching `.sha256` URL for integrity verification. */
  shaUrl: string;
}

// ─── Platform detection ─────────────────────────────────────────────────────

export interface Target {
  os: "darwin" | "linux" | "windows";
  arch: "x64" | "arm64";
  /** Final asset filename matching `release.yml`'s upload step. */
  assetName: string;
}

/**
 * Detect the current build target. Throws on unsupported platforms so we
 * fail loud rather than download the wrong binary.
 */
export function detectTarget(): Target {
  const platform = process.platform;
  // node's Architecture type on 2026 LTS doesn't include "amd64"/"aarch64"
  // (they come through as "x64"/"arm64") but some older environments surface
  // the alternate names — cast to `string` so we can still accept them.
  const arch = process.arch as string;

  let os: Target["os"];
  if (platform === "darwin") os = "darwin";
  else if (platform === "linux") os = "linux";
  else if (platform === "win32") os = "windows";
  else throw new Error(`Unsupported OS: ${platform}`);

  let normArch: Target["arch"];
  if (arch === "x64" || arch === "amd64") normArch = "x64";
  else if (arch === "arm64" || arch === "aarch64") normArch = "arm64";
  else throw new Error(`Unsupported arch: ${arch}`);

  const assetName = `ndea-${os}-${normArch}${os === "windows" ? ".exe" : ""}`;
  return { os, arch: normArch, assetName };
}

// ─── Fetcher ────────────────────────────────────────────────────────────────

export interface FetchManifestOptions {
  /** Override URL (tests). */
  url?: string;
  /** Override `fetch` implementation (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch + validate the manifest. Throws if the response isn't JSON or doesn't
 * match the expected shape.
 */
export async function fetchManifestRaw(options: FetchManifestOptions = {}): Promise<Manifest> {
  const url = options.url ?? MANIFEST_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`manifest fetch failed (${res.status} ${res.statusText}) at ${url}`);
  }
  const body = (await res.json()) as unknown;
  return validateManifest(body);
}

/**
 * Resolve the target asset for a given release channel.
 *
 * Returns `tag`, a direct binary URL, and a matching `.sha256` URL — the
 * three things both install.sh and `ndea update` need.
 */
export async function fetchManifest(channel: Channel, options: FetchManifestOptions = {}): Promise<ResolvedAsset> {
  const manifest = await fetchManifestRaw(options);
  const tag = manifest.channels[channel];
  if (!tag) {
    throw new Error(
      `manifest has no tag for channel "${channel}" (available: ${Object.keys(manifest.channels).join(", ") || "none"})`,
    );
  }
  const target = detectTarget();
  const base = `https://github.com/${REPO}/releases/download/${tag}`;
  return {
    tag,
    assetUrl: `${base}/${target.assetName}`,
    shaUrl: `${base}/${target.assetName}.sha256`,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateManifest(raw: unknown): Manifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("manifest is not a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const channels = obj.channels;
  if (!channels || typeof channels !== "object") {
    throw new Error("manifest missing `channels` object");
  }
  const c = channels as Record<string, unknown>;
  const validated: Manifest["channels"] = {};
  for (const name of CHANNELS) {
    const v = c[name];
    if (v == null) continue;
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(`manifest channel "${name}" must be a non-empty string, got ${typeof v}`);
    }
    validated[name] = v;
  }
  return { channels: validated };
}

// ─── Checksum helpers ───────────────────────────────────────────────────────

/**
 * Compute a hex-encoded SHA-256 digest of a binary buffer. Uses Bun's
 * bundled hash to avoid pulling in Node's crypto when the caller already
 * has an ArrayBuffer in hand.
 */
export function sha256Hex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

/**
 * Parse a `.sha256` file body. GitHub releases + `shasum -a 256` format as
 * `<hex>  <filename>` — we accept either that or a bare hex string.
 */
export function parseShaFile(body: string): string {
  const trimmed = body.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  const match = /^([a-f0-9]{64})\s/i.exec(trimmed);
  if (match) return match[1].toLowerCase();
  throw new Error(`unrecognised checksum file contents: ${trimmed.slice(0, 80)}`);
}
