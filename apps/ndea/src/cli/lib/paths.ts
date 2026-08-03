/**
 * State-directory + binary-path helpers shared across install and update.
 *
 * Layout:
 *   ~/.ndea/                                 : state root
 *   ~/.ndea/versions/<tag>/ndea              : bun-compiled binary (symlink target)
 *   ~/.ndea/current-version                  : plain-text pointer (tag + sha256)
 *   ~/.ndea/locks/install.lock               : install/update mutex
 *   ~/.local/bin/ndea                        : symlink → versions/<tag>/ndea
 *
 * The compiled binary embeds libduckdb; the preloader extracts it to
 * ~/.cache/ndea/<version>/ on first run. No sidecar file, no wrapper.
 */

import { realpathSync } from "node:fs";
import { readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

/** Resolve the user's home directory, honoring `$HOME` on POSIX. */
function resolveHome(): string {
  const envHome = process.env.HOME;
  if (envHome && process.platform !== "win32") return envHome;
  return homedir();
}

/** `~/.ndea`: root of the CLI's per-user state. */
export function stateDir(): string {
  return resolve(resolveHome(), ".ndea");
}

/** `~/.ndea/versions`: root of the installed-binaries tree. */
export function versionsDir(): string {
  return resolve(stateDir(), "versions");
}

/** `~/.ndea/versions/<tag>`: directory holding one installed binary. */
export function versionDir(tag: string): string {
  return resolve(versionsDir(), tag);
}

/** `~/.ndea/versions/<tag>/ndea`: the bun-compiled binary inside a version dir. */
export function versionedBinaryPath(tag: string): string {
  return resolve(versionDir(tag), "ndea");
}

/** `~/.ndea/locks`: flock directory for install/update mutex. */
export function locksDir(): string {
  return resolve(stateDir(), "locks");
}

/** `~/.ndea/logs`: log directory for future telemetry / install traces. */
export function logsDir(): string {
  return resolve(stateDir(), "logs");
}

/** `~/.ndea/locks/install.lock`: file backing the install/update flock. */
export function installLockPath(): string {
  return resolve(locksDir(), "install.lock");
}

/** `~/.ndea/current-version`: plain-text file with the installed tag + checksum. */
export function currentVersionPath(): string {
  return resolve(stateDir(), "current-version");
}

/** `~/.local/bin/ndea`: the user-facing symlink the installer puts on `$PATH`. */
export function launcherPath(): string {
  return resolve(resolveHome(), ".local", "bin", "ndea");
}

/** True if we're running a compiled `ndea` binary (vs. `bun run src/cli/index.ts`). */
export function isCompiledBinary(): boolean {
  return Bun.embeddedFiles.length > 0;
}

/**
 * Find the user-facing symlink that points at our running binary.
 *
 * `process.execPath` resolves through the launcher to the canonical binary
 * inside the versions tree, so commands that swap the symlink need the link
 * itself rather than the binary it currently targets.
 *
 * Returns the launcher path when it resolves to the running binary.
 */
export function activeLauncher(): string | undefined {
  const binAbs = realpathSync(process.execPath);
  const candidate = launcherPath();
  try {
    if (realpathSync(candidate) === binAbs) return candidate;
  } catch {
    // Launcher doesn't exist or isn't readable.
  }
  return undefined;
}

/**
 * Require the active launcher path and exit with a clear error if missing.
 *
 * Used by commands that mutate the install (`update`): they
 * can't operate sensibly without knowing which symlink to swap.
 */
export function requireActiveLauncher(): string {
  const launcher = activeLauncher();
  if (!launcher) {
    console.error(
      `Error: cannot locate the active \`ndea\` symlink at ${launcherPath()}. Reinstall with the ndea installer.`,
    );
    process.exit(1);
  }
  return launcher;
}

/**
 * Resolve a launcher symlink to the absolute path it points at, or `null` when
 * it is missing or not a symlink. Callers pair this with `pathContains` to
 * refuse to modify an install the standalone installer does not own.
 */
export async function resolveLauncherTarget(link: string): Promise<string | null> {
  const target = await readlink(link).catch(() => null);
  return target === null ? null : resolve(dirname(link), target);
}
