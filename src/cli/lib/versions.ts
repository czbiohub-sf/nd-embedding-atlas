/**
 * Helpers for the `~/.ndea/versions/<tag>/` tree.
 * Shared by `rollback`, `gc`, and `doctor`.
 *
 * Each version dir contains:
 *   - `ndea`     — POSIX-sh wrapper (the file `$NDEA_BIN_DIR/ndea` symlinks at)
 *   - `ndea.bin` — bun-compiled binary
 *   - `libduckdb.{dylib,so}` — DuckDB engine sidecar
 *
 * `wrapperPath` is the symlink target — what `readlink($NDEA_BIN_DIR/ndea)`
 * returns. `binaryPath` is what runs after the wrapper `exec`s the actual
 * binary; downloads / writes target it directly.
 */

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface VersionEntry {
  tag: string;
  /** `<versionDir>/ndea` — the wrapper script the symlink points at. */
  wrapperPath: string;
  /** `<versionDir>/ndea.bin` — the bun-compiled binary. */
  binaryPath: string;
  mtimeMs: number;
}

/**
 * Enumerate installed versions, sorted most-recent → least-recent by mtime.
 * Skips entries whose `ndea.bin` is missing (partial install / manual edit).
 *
 * Resolves paths relative to the supplied `root` so callers can pass a
 * versions/ tree at a non-default location (e.g. tests with a sandboxed
 * NDEA_HOME).
 *
 * mtime is taken from `ndea.bin` because the wrapper script is regenerated
 * on every update and would otherwise dominate ordering.
 */
export async function listVersions(root: string): Promise<VersionEntry[]> {
  if (!existsSync(root)) return [];
  const tags = await readdir(root);
  const out: VersionEntry[] = [];
  for (const tag of tags) {
    const versionRoot = resolve(root, tag);
    const wrapperPath = resolve(versionRoot, "ndea");
    const binaryPath = resolve(versionRoot, "ndea.bin");
    if (!existsSync(binaryPath)) continue;
    try {
      const info = await stat(binaryPath);
      out.push({ tag, wrapperPath, binaryPath, mtimeMs: info.mtimeMs });
    } catch {
      // Skip unreadable entries silently.
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}
