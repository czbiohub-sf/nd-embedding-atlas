/**
 * `ndea self prune`: prune old installed versions from `~/.ndea/versions/`.
 *
 * The active version (whatever `~/.local/bin/ndea` symlinks at) is ALWAYS
 * preserved: prune resolves the symlink before pruning so the user can never
 * accidentally remove their working install.
 *
 * Default keeps only the active version; `--keep N` retains N in total,
 * newest first.
 */

import { defineCommand } from "@crustjs/core";
import { existsSync } from "node:fs";
import { z } from "zod";
import { detectInstallManager, pathContains } from "../lib/install-manager.ts";
import { acquireLock } from "../lib/lock.ts";
import {
  activeLauncher,
  installLockPath,
  isCompiledBinary,
  resolveLauncherTarget,
  versionsDir,
} from "../../env/paths.ts";
import { pruneVersionCaches, pruneVersions } from "../lib/prune.ts";
import { label, mb, ok } from "../lib/style.ts";

export default defineCommand(
  "prune",
  { description: "Prune old installed ndea versions from the versions tree" },
  (command) =>
    command
      .flags({
        name: "keep",
        type: "string",
        schema: z.coerce.number().int().min(1).default(1),
        description: "Number of versions to keep (active counts; default: 1)",
      })
      .action(async ({ flags, stdout }) => {
        if (!isCompiledBinary()) throw new Error("`ndea self prune` only works from a compiled binary");

        const manager = await detectInstallManager();
        if (manager.kind === "mise") {
          stdout("This ndea install is managed by mise; ~/.ndea/versions is not active install history.");
          stdout("Run `mise prune` to remove mise-managed tool versions that are no longer configured.");
          return;
        }

        const root = versionsDir();
        if (!existsSync(root)) {
          stdout("Nothing to prune: no versions installed yet.");
          return;
        }

        const link = activeLauncher();
        const activeAbs = link ? await resolveLauncherTarget(link) : null;
        if (!activeAbs || !pathContains(root, activeAbs)) {
          throw new Error(
            `active ndea launcher is not a symlink into ${root}\n` +
              "  refusing to prune an install not owned by the standalone ndea installer",
          );
        }

        const lock = await acquireLock(installLockPath());
        try {
          const result = await pruneVersions({ root, activeAbs, keep: flags.keep });
          result.freedBytes += await pruneVersionCaches(result.pruned.map((entry) => entry.tag));
          if (result.pruned.length === 0) {
            stdout(`Nothing to prune: ${result.kept.length} version(s) currently installed, all kept.`);
            return;
          }
          for (const entry of result.pruned) stdout(`  ${label(`removed ${entry.tag}`)}`);
          stdout(`\n${ok(`Pruned ${result.pruned.length} version(s), freed ${mb(result.freedBytes)}.`)}`);
          stdout(label(`Kept ${result.kept.length} version(s).`));
        } finally {
          await lock.release();
        }
      }),
);
