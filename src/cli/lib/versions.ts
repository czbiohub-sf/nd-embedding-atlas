/**
 * Helpers for the `~/.ndea/versions/<tag>/ndea` tree.
 * Shared by `rollback`, `gc`, and `doctor`.
 */

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface VersionEntry {
  tag: string;
  binaryPath: string;
  mtimeMs: number;
}

/**
 * Enumerate installed versions, sorted most-recent → least-recent by mtime.
 * Skips entries whose binary file is missing (partial install / manual edit).
 *
 * Resolves binary paths relative to the supplied `root` so callers can
 * pass a versions/ tree at a non-default location (e.g. tests with a
 * sandboxed NDEA_HOME).
 */
export async function listVersions(root: string): Promise<VersionEntry[]> {
  if (!existsSync(root)) return [];
  const tags = await readdir(root);
  const out: VersionEntry[] = [];
  for (const tag of tags) {
    const binaryPath = resolve(root, tag, "ndea");
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
