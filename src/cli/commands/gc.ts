/**
 * `ndea gc` — prune old installed versions from `~/.ndea/versions/`.
 *
 * The active version (whatever `$NDEA_BIN_DIR/ndea` symlinks at) is ALWAYS
 * preserved — gc resolves the symlink before pruning so the user can never
 * accidentally remove their working install.
 *
 * Default keeps `current + 1 previous` (enough for one rollback).
 * `--keep N` overrides; `--all` keeps only the active version.
 */

import { defineCommand, option } from "@bunli/core";
import { existsSync } from "node:fs";
import { readlink, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { acquireLock } from "../lib/lock.ts";
import { installLockPath, isCompiledBinary, resolveSelfPath, versionDir, versionsDir } from "../lib/paths.ts";
import { listVersions } from "../lib/versions.ts";

export default defineCommand({
  name: "gc" as const,
  description: "Prune old installed ndea versions from the versions tree",
  options: {
    keep: option(z.coerce.number().int().min(1).default(2), {
      description: "Number of versions to keep (active counts; default: 2)",
    }),
    all: option(z.coerce.boolean().default(false), {
      description: "Keep only the active version (overrides --keep)",
    }),
  },
  async handler({ flags }) {
    if (!isCompiledBinary()) {
      console.error("Error: `ndea gc` only works from a compiled binary.");
      process.exit(1);
    }

    const root = versionsDir();
    if (!existsSync(root)) {
      console.log("Nothing to prune — no versions installed yet.");
      return;
    }

    const link = resolveSelfPath();
    const activeBinary = await readlink(link).catch(() => null);
    const activeAbs = activeBinary ? resolve(activeBinary) : null;

    const all = await listVersions(root);
    if (all.length === 0) {
      console.log("Nothing to prune — versions/ is empty.");
      return;
    }

    // Active first, then most recent → least recent.
    const active = all.find((e) => e.binaryPath === activeAbs);
    const others = all.filter((e) => e.binaryPath !== activeAbs);

    const keepCount = flags.all ? 0 : Math.max(0, flags.keep - (active ? 1 : 0));
    const keepOthers = others.slice(0, keepCount);
    const prune = others.slice(keepCount);

    if (prune.length === 0) {
      const kept = (active ? 1 : 0) + keepOthers.length;
      console.log(`Nothing to prune — ${kept} version(s) currently installed, all kept.`);
      return;
    }

    const lock = await acquireLock(installLockPath()).catch((err: unknown) => {
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });

    try {
      let freed = 0;
      for (const entry of prune) {
        const dir = versionDir(entry.tag);
        const size = await directorySize(dir).catch(() => 0);
        await rm(dir, { recursive: true, force: true });
        freed += size;
        console.log(`  removed ${entry.tag}`);
      }
      const mb = (freed / (1024 * 1024)).toFixed(1);
      console.log(`\nPruned ${prune.length} version(s), freed ${mb} MB.`);
      const kept = (active ? 1 : 0) + keepOthers.length;
      console.log(`Kept ${kept} version(s).`);
    } finally {
      await lock.release();
    }
  },
});

async function directorySize(path: string): Promise<number> {
  let total = 0;
  const entries = await import("node:fs/promises").then((m) => m.readdir(path, { withFileTypes: true }));
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
