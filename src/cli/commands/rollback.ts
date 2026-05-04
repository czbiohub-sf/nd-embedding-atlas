/**
 * `ndea rollback` — repoint the active symlink to the previous installed
 * version.
 *
 * The versions tree (`~/.ndea/versions/<tag>/ndea`) keeps every binary that
 * was ever installed via `install.sh` or `ndea update`. Rollback walks the
 * tree, finds the most-recently-modified version that is *not* the
 * currently-active one, and atomically swaps the symlink to point there.
 *
 * Each rollback consumes one entry — running it again rolls back further.
 * `ndea update` wipes nothing, so all history stays available until the
 * user prunes `~/.ndea/versions/` manually.
 */

import { defineCommand } from "@bunli/core";
import { existsSync } from "node:fs";
import { readlink, rename, symlink, unlink } from "node:fs/promises";
import { acquireLock } from "../lib/lock.ts";
import {
  currentVersionPath,
  installLockPath,
  isCompiledBinary,
  requireActiveLauncher,
  versionsDir,
} from "../lib/paths.ts";
import { listVersions } from "../lib/versions.ts";

export default defineCommand({
  name: "rollback" as const,
  description: "Switch the active ndea binary to the previous installed version",
  options: {},
  async handler() {
    if (!isCompiledBinary()) {
      console.error("Error: `ndea rollback` only works from a compiled binary.");
      process.exit(1);
    }

    if (process.env.NDEA_DISABLE_UPDATES === "1") {
      console.error("ndea: updates disabled by NDEA_DISABLE_UPDATES");
      process.exit(1);
    }

    const root = versionsDir();
    if (!existsSync(root)) {
      console.error("Error: no versions directory found — nothing to roll back.");
      console.error(`  Expected: ${root}`);
      process.exit(1);
    }

    const link = requireActiveLauncher();
    const activeTarget = await readlink(link).catch(() => null);

    const entries = await listVersions(root);
    if (entries.length === 0) {
      console.error("Error: no versions installed.");
      process.exit(1);
    }

    // Pick the most-recently-modified version whose wrapper path differs
    // from the currently-resolved one. Mtime ordering is stable across
    // installs because `Bun.write` updates ndea.bin on every download.
    // Symlinks target the wrapper, so wrapperPath is what `readlink` returns.
    const candidate = entries.find((e) => e.wrapperPath !== activeTarget);
    if (!candidate) {
      console.error("Error: only one version installed — nothing to roll back to.");
      process.exit(1);
    }

    const lock = await acquireLock(installLockPath()).catch((err: unknown) => {
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });

    try {
      const tmpLink = `${link}.tmp`;
      await unlink(tmpLink).catch(() => {});
      await symlink(candidate.wrapperPath, tmpLink);
      await rename(tmpLink, link);

      await Bun.write(currentVersionPath(), `${candidate.tag}\n`);

      console.log(`Rolled back to ${candidate.tag} → ${link}`);
      console.log("Run `ndea --version` to confirm.");
    } finally {
      await lock.release();
    }
  },
});
