/**
 * `ndea gc`: prune old installed versions from `~/.ndea/versions/`.
 *
 * The active version (whatever `~/.local/bin/ndea` symlinks at) is ALWAYS
 * preserved: gc resolves the symlink before pruning so the user can never
 * accidentally remove their working install.
 *
 * Default keeps only the active version; `--keep N` retains N in total,
 * newest first.
 */

import { defineCommand, option } from "@bunli/core";
import { existsSync } from "node:fs";
import { z } from "zod";
import { detectInstallManager, pathContains } from "../lib/install-manager.ts";
import { acquireLock } from "../lib/lock.ts";
import { activeLauncher, installLockPath, isCompiledBinary, resolveLauncherTarget, versionsDir } from "../lib/paths.ts";
import { pruneVersionCaches, pruneVersions } from "../lib/prune.ts";

export default defineCommand({
  name: "gc" as const,
  description: "Prune old installed ndea versions from the versions tree",
  options: {
    keep: option(z.coerce.number().int().min(1).default(1), {
      description: "Number of versions to keep (active counts; default: 1)",
    }),
  },
  async handler({ flags }) {
    if (!isCompiledBinary()) {
      console.error("Error: `ndea gc` only works from a compiled binary.");
      process.exit(1);
    }

    const manager = await detectInstallManager();
    if (manager.kind === "mise") {
      console.log("This ndea install is managed by mise; ~/.ndea/versions is not active install history.");
      console.log("Run `mise prune` to remove mise-managed tool versions that are no longer configured.");
      return;
    }

    const root = versionsDir();
    if (!existsSync(root)) {
      console.log("Nothing to prune: no versions installed yet.");
      return;
    }

    const link = activeLauncher();
    const activeAbs = link ? await resolveLauncherTarget(link) : null;
    if (!activeAbs || !pathContains(root, activeAbs)) {
      console.error(`Error: active ndea launcher is not a symlink into ${root}.`);
      console.error("  Refusing to prune an install not owned by the standalone ndea installer.");
      process.exit(1);
      throw new Error("unreachable");
    }

    const lock = await acquireLock(installLockPath()).catch((err: unknown) => {
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });

    try {
      const result = await pruneVersions({ root, activeAbs, keep: flags.keep });
      result.freedBytes += await pruneVersionCaches(result.pruned.map((entry) => entry.tag));
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
