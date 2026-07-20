/**
 * `ndea gc`: prune old installed versions from `~/.ndea/versions/`.
 *
 * The active version (whatever `$NDEA_BIN_DIR/ndea` symlinks at) is ALWAYS
 * preserved: gc resolves the symlink before pruning so the user can never
 * accidentally remove their working install.
 *
 * Default keeps `current + 1 previous` (enough for one rollback).
 * `--keep N` overrides; `--all` keeps only the active version.
 */

import { defineCommand, option } from "@bunli/core";
import { existsSync } from "node:fs";
import { readlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { acquireLock } from "../lib/lock.ts";
import { activeLauncher, installLockPath, isCompiledBinary, versionsDir } from "../lib/paths.ts";
import { pruneVersions } from "../lib/prune.ts";

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
      console.log("Nothing to prune: no versions installed yet.");
      return;
    }

    // gc is read-mostly: failure to find the launcher symlink means
    // "can't mark active", not a hard error. The mutating side (rm of
    // dirs) is gated by pruneVersions, which always preserves the active
    // version when one is detected.
    const link = activeLauncher();
    const activeTarget = link ? await readlink(link).catch(() => null) : null;
    const activeAbs = activeTarget ? resolve(activeTarget) : null;

    const lock = await acquireLock(installLockPath()).catch((err: unknown) => {
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });

    try {
      const result = await pruneVersions({ root, activeAbs, keep: flags.all ? 1 : flags.keep });
      if (result.pruned.length === 0) {
        console.log(`Nothing to prune: ${result.kept.length} version(s) currently installed, all kept.`);
        return;
      }
      for (const entry of result.pruned) {
        console.log(`  removed ${entry.tag}`);
      }
      const mb = (result.freedBytes / (1024 * 1024)).toFixed(1);
      console.log(`\nPruned ${result.pruned.length} version(s), freed ${mb} MB.`);
      console.log(`Kept ${result.kept.length} version(s).`);
    } finally {
      await lock.release();
    }
  },
});
