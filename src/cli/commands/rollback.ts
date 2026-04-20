/**
 * `ndea rollback` — restore the previous binary from `<self>.bak`.
 *
 * `ndea update` preserves one level of history: before applying a staged
 * `.pending`, the existing binary is renamed to `.bak`. This command undoes
 * that swap so users can recover from a bad release without reinstalling.
 */

import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { acquireLock } from "../lib/lock.ts";
import { installLockPath, isCompiledBinary, resolveSelfPath } from "../lib/paths.ts";

export default defineCommand({
  meta: {
    name: "rollback",
    description: "Restore the previous ndea binary from <self>.bak",
  },
  async run() {
    if (!isCompiledBinary()) {
      console.error("Error: `ndea rollback` only works from a compiled binary.");
      process.exit(1);
    }

    const self = resolveSelfPath();
    const bak = `${self}.bak`;

    if (!existsSync(bak)) {
      console.error("Error: no backup found — nothing to roll back.");
      console.error(`  Expected: ${bak}`);
      process.exit(1);
    }

    const lock = await acquireLock(installLockPath()).catch((err: unknown) => {
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });

    try {
      // Move current → .discarded, then .bak → current. If anything goes
      // wrong we try to restore the original file.
      const discarded = `${self}.discarded`;
      await rm(discarded, { force: true }).catch(() => {});

      try {
        await rename(self, discarded);
        await rename(bak, self);
        await rm(discarded, { force: true }).catch(() => {});
      } catch (err) {
        // Attempt to recover.
        if (!existsSync(self) && existsSync(discarded)) {
          await rename(discarded, self).catch(() => {});
        }
        throw err;
      }

      console.log(`Rolled back to previous binary at ${self}`);
      console.log("Run `ndea --version` to confirm.");
    } finally {
      await lock.release();
    }
  },
});
