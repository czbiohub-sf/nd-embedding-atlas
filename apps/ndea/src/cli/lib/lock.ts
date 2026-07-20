/**
 * Cross-platform exclusive lock for install / update.
 *
 * Real POSIX `flock(2)` would be nicer but isn't available from userland JS
 * on every platform. Instead we use the portable "exclusive O_CREAT lockfile"
 * pattern: write a PID file with `wx` flags: the open fails if the file
 * already exists. Stale-PID detection covers the `SIGKILL` crash path.
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Lock {
  path: string;
  release(): Promise<void>;
}

/**
 * Acquire an exclusive lockfile at `path`. Fails fast when the lock is held
 * by another live process.
 */
export async function acquireLock(path: string): Promise<Lock> {
  mkdirSync(dirname(path), { recursive: true });

  // Stale-lock detection: if a PID file is present but its owner is dead,
  // reclaim it. We use `kill -0` semantics (signal 0) to check liveness.
  if (existsSync(path)) {
    try {
      const existingPid = Number.parseInt((await readFile(path, "utf8")).trim(), 10);
      if (Number.isFinite(existingPid) && existingPid > 0 && isProcessAlive(existingPid)) {
        throw new Error(`install/update lock held by PID ${existingPid} (${path})`);
      }
      // Stale: remove and proceed.
      await rm(path, { force: true });
    } catch (err) {
      if (err instanceof Error && /lock held/.test(err.message)) throw err;
      // Unreadable PID file: try to reclaim.
      await rm(path, { force: true }).catch(() => {});
    }
  }

  // Exclusive create. Bun.write doesn't expose O_EXCL yet, so go through fs.
  try {
    await writeFile(path, `${process.pid}\n`, { flag: "wx" });
  } catch (err) {
    // Race with another acquirer: treat as held.
    throw new Error(`install/update lock acquisition failed at ${path}: ${errMsg(err)}`, { cause: err });
  }

  return {
    path,
    async release() {
      await rm(path, { force: true }).catch(() => {});
    },
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = dead, EPERM = alive but not ours
    return err instanceof Error && "code" in err && (err as { code?: string }).code === "EPERM";
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
