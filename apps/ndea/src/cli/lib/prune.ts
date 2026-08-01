/**
 * Shared prune logic: used by `ndea gc` (explicit) and `ndea update`
 * (auto-gc after a successful update).
 *
 * Each version dir is ~185 MB on disk. Without pruning, aggressive update
 * cadences fill `~/.ndea/` quickly. The auto-gc path runs with `keep=1`
 * by default, preserving only the active version.
 */

import { readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { listVersions, type VersionEntry } from "./versions.ts";

interface PruneOptions {
  /** Versions tree root (`versionsDir()`). */
  root: string;
  /** Path the symlink points at: the binary for the active version. */
  activeAbs: string | null;
  /** Total entries to keep, *including* the active one. `Infinity` = keep all. */
  keep: number;
}

interface PruneResult {
  pruned: VersionEntry[];
  kept: VersionEntry[];
  active: VersionEntry | undefined;
  freedBytes: number;
}

/**
 * Decide which version dirs to delete and remove them.
 *
 * Selection rule: the active version is always kept; among inactive
 * versions, keep the (`keep` − 1) most recently modified, prune the rest.
 * If no active version is detected, keep the `keep` most recent overall.
 */
export async function pruneVersions(opts: PruneOptions): Promise<PruneResult> {
  const all = await listVersions(opts.root);
  if (all.length === 0) {
    return { pruned: [], kept: [], active: undefined, freedBytes: 0 };
  }

  const active = all.find((e) => e.binaryPath === opts.activeAbs);
  const others = all.filter((e) => e !== active);

  const keepCount = opts.keep === Infinity ? others.length : Math.max(0, opts.keep - (active ? 1 : 0));
  const keepOthers = others.slice(0, keepCount);
  const prune = others.slice(keepCount);

  let freedBytes = 0;
  for (const entry of prune) {
    // Resolve relative to the supplied root (not the global versionDir
    // helper) so callers and tests operate on the tree they passed in.
    const dir = resolve(opts.root, entry.tag);
    const size = await directorySize(dir).catch(() => 0);
    await rm(dir, { recursive: true, force: true });
    freedBytes += size;
  }

  return {
    pruned: prune,
    kept: active ? [active, ...keepOthers] : keepOthers,
    active,
    freedBytes,
  };
}

/** Remove native-library caches corresponding to pruned version tags. */
export async function pruneVersionCaches(
  tags: readonly string[],
  root = resolve(process.env.XDG_CACHE_HOME ?? resolve(homedir(), ".cache"), "ndea"),
): Promise<number> {
  let freedBytes = 0;
  for (const tag of tags) {
    const dir = resolve(root, tag.replace(/^v/, ""));
    const size = await directorySize(dir).catch(() => 0);
    await rm(dir, { recursive: true, force: true });
    freedBytes += size;
  }
  return freedBytes;
}

async function directorySize(path: string): Promise<number> {
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(child).catch(() => 0);
    } else if (entry.isFile()) {
      const info = await stat(child).catch(() => null);
      if (info) total += info.size;
    }
  }
  return total;
}
