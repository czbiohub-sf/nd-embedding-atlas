/**
 * Helpers for the `~/.ndea/versions/<tag>/` tree.
 * Shared by `gc` and `doctor`.
 *
 * Each version dir contains a single file:
 *   - `ndea`: bun-compiled binary
 *
 * The symlink at `~/.local/bin/ndea` points directly at this binary;
 * `readlink` returns the binary path.
 */

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface VersionEntry {
  tag: string;
  /** `<versionDir>/ndea`: the bun-compiled binary the symlink points at. */
  binaryPath: string;
  mtimeMs: number;
}

/**
 * Enumerate installed versions, sorted most-recent → least-recent by mtime.
 * Skips entries whose `ndea` is missing (partial install / manual edit).
 *
 * Resolves paths relative to the supplied `root` so callers can pass a
 * versions tree at a supplied location (for example, tests with a sandbox).
 */
export async function listVersions(root: string): Promise<VersionEntry[]> {
  if (!existsSync(root)) return [];
  const tags = await readdir(root);
  const out: VersionEntry[] = [];
  for (const tag of tags) {
    const versionRoot = resolve(root, tag);
    const binaryPath = resolve(versionRoot, "ndea");
    if (!existsSync(binaryPath)) continue;
    try {
      const info = await stat(binaryPath);
      out.push({ tag, binaryPath, mtimeMs: info.mtimeMs });
    } catch {
      // Skip unreadable entries silently.
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}
