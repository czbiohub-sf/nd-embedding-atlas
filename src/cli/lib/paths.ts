/**
 * State-directory + binary-path helpers shared across install / update /
 * rollback.
 *
 * Layout:
 *   ~/.ndea/                               — state root (override via NDEA_HOME)
 *   ~/.ndea/versions/<tag>/ndea            — installed binaries, one per version
 *   ~/.ndea/current-version                — plain-text pointer (tag + sha256)
 *   ~/.ndea/locks/install.lock             — install/update mutex
 *   $NDEA_BIN_DIR/ndea                     — symlink to active versions/<tag>/ndea
 */

import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Resolve the user's home directory with override hooks — `$NDEA_HOME`
 * wins for advanced setups (CI, dev containers), then `$HOME` on POSIX so
 * tests can sandbox the state dir, finally Node's built-in `os.homedir()`.
 */
function resolveHome(): string {
  const ndeaHome = process.env.NDEA_HOME;
  if (ndeaHome) return ndeaHome;
  const envHome = process.env.HOME;
  if (envHome && process.platform !== "win32") return envHome;
  return homedir();
}

/** `~/.ndea` — root of the CLI's per-user state. */
export function stateDir(): string {
  return resolve(resolveHome(), ".ndea");
}

/** `~/.ndea/versions` — root of the installed-binaries tree. */
export function versionsDir(): string {
  return resolve(stateDir(), "versions");
}

/** `~/.ndea/versions/<tag>` — directory holding one installed binary. */
export function versionDir(tag: string): string {
  return resolve(versionsDir(), tag);
}

/** `~/.ndea/versions/<tag>/ndea` — the binary file inside a version dir. */
export function versionedBinaryPath(tag: string): string {
  return resolve(versionDir(tag), "ndea");
}

/** `~/.ndea/locks` — flock directory for install/update mutex. */
export function locksDir(): string {
  return resolve(stateDir(), "locks");
}

/** `~/.ndea/logs` — log directory for future telemetry / install traces. */
export function logsDir(): string {
  return resolve(stateDir(), "logs");
}

/** `~/.ndea/locks/install.lock` — file backing the install/update flock. */
export function installLockPath(): string {
  return resolve(locksDir(), "install.lock");
}

/** `~/.ndea/current-version` — plain-text file with the installed tag + checksum. */
export function currentVersionPath(): string {
  return resolve(stateDir(), "current-version");
}

/**
 * Resolve the path of the currently-running binary.
 *
 * In a compiled binary, `process.execPath` points at the binary itself. In
 * `bun run` (dev), it points at the Bun runtime — the update/rollback
 * commands refuse to operate in that mode rather than clobbering `bun`.
 */
export function resolveSelfPath(): string {
  return process.execPath;
}

/** True if we're running a compiled `ndea` binary (vs. `bun run src/cli/index.ts`). */
export function isCompiledBinary(): boolean {
  const exec = process.execPath;
  // A compiled single-file binary's execPath will point at a file whose
  // basename is our binary; running via `bun` leaves it named `bun`.
  const base = exec.split(/[\\/]/).pop() ?? "";
  return !/^bun(\.exe)?$/i.test(base);
}
