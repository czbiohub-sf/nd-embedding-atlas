/**
 * State-directory + binary-path helpers shared across install / update /
 * rollback.
 *
 * Layout:
 *   ~/.ndea/                                  — state root (override via NDEA_HOME)
 *   ~/.ndea/versions/<tag>/ndea               — bun-compiled binary (symlink target)
 *   ~/.ndea/current-version                   — plain-text pointer (tag + sha256)
 *   ~/.ndea/locks/install.lock                — install/update mutex
 *   $NDEA_BIN_DIR/ndea                        — symlink → versions/<tag>/ndea
 *
 * The compiled binary embeds libduckdb; the preloader extracts it to
 * ~/.cache/ndea/<version>/ on first run. No sidecar file, no wrapper.
 */

import { realpathSync } from "node:fs";
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

/** `~/.ndea/versions/<tag>/ndea` — the bun-compiled binary inside a version dir. */
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

/** True if we're running a compiled `ndea` binary (vs. `bun run src/cli/index.ts`). */
export function isCompiledBinary(): boolean {
  const exec = process.execPath;
  // Bun resolves symlinks in execPath, so a compiled binary's execPath
  // is the real file path inside the versions tree. The basename is
  // always `ndea` (no .bin suffix). Running via `bun run` leaves
  // execPath pointing at `bun` — that's what we exclude.
  const base = exec.split(/[\\/]/).pop() ?? "";
  return !/^bun(\.exe)?$/i.test(base);
}

/**
 * Find the user-facing symlink that points at our running binary.
 *
 * The install layout puts the symlink at `$NDEA_BIN_DIR/ndea` (default
 * `~/.local/bin/ndea`), pointing at `~/.ndea/versions/<tag>/ndea`. To
 * update or rollback, we need to swap that symlink — but `process.execPath`
 * resolves through it to the canonical binary path inside the versions
 * tree.
 *
 * Strategy: walk `$PATH` for any `ndea` entry whose `realpath()` matches
 * `process.execPath`. Returns the symlink path on the first match, else
 * `undefined`.
 *
 * Honours `$NDEA_LAUNCHER` if set, for advanced setups / overrides.
 */
export function activeLauncher(): string | undefined {
  const override = process.env.NDEA_LAUNCHER;
  if (override) return override;

  const binAbs = realpathSync(process.execPath);
  const pathEntries = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of pathEntries) {
    const candidate = resolve(dir, "ndea");
    try {
      const resolved = realpathSync(candidate);
      if (resolved === binAbs) return candidate;
    } catch {
      // Candidate doesn't exist or isn't readable; skip.
    }
  }
  return undefined;
}

/**
 * Require the active launcher path and exit with a clear error if missing.
 *
 * Used by commands that mutate the install (`update`, `rollback`) — they
 * can't operate sensibly without knowing which symlink to swap.
 */
export function requireActiveLauncher(): string {
  const launcher = activeLauncher();
  if (!launcher) {
    console.error(
      "Error: cannot locate the `ndea` symlink on $PATH. " +
        "Reinstall via scripts/install.sh, or set NDEA_LAUNCHER to the symlink path.",
    );
    process.exit(1);
  }
  return resolve(launcher);
}
