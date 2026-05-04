/**
 * Shared prune logic — used by `ndea gc` (explicit) and `ndea update`
 * (auto-gc after a successful update).
 *
 * Each version dir is ~190 MB on disk (binary + libduckdb sidecar). Without
 * pruning, aggressive update cadences fill `~/.ndea/` quickly. The auto-gc
 * path runs with `keep=2` by default — current + one rollback target.
 */

import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { listVersions, type VersionEntry } from "./versions.ts";

interface PruneOptions {
  /** Versions tree root (`versionsDir()`). */
  root: string;
  /** Path the symlink points at — the wrapper for the active version. */
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

  const active = all.find((e) => e.wrapperPath === opts.activeAbs);
  const others = all.filter((e) => e !== active);

  const keepCount = opts.keep === Infinity ? others.length : Math.max(0, opts.keep - (active ? 1 : 0));
  const keepOthers = others.slice(0, keepCount);
  const prune = others.slice(keepCount);

  let freedBytes = 0;
  for (const entry of prune) {
    // Resolve relative to the supplied root (not the global versionDir
    // helper) so callers with a sandboxed NDEA_HOME — and tests — operate
    // on the tree they passed in.
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

async function directorySize(path: string): Promise<number> {
  const { readdir } = await import("node:fs/promises");
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
