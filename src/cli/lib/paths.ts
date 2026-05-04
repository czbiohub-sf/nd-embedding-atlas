/**
 * State-directory + binary-path helpers shared across install / update /
 * rollback.
 *
 * Layout:
 *   ~/.ndea/                                  — state root (override via NDEA_HOME)
 *   ~/.ndea/versions/<tag>/ndea               — POSIX-sh wrapper (symlink target)
 *   ~/.ndea/versions/<tag>/ndea.bin           — bun-compiled binary
 *   ~/.ndea/versions/<tag>/libduckdb.{dylib,so} — DuckDB engine sidecar
 *   ~/.ndea/current-version                   — plain-text pointer (tag + sha256)
 *   ~/.ndea/locks/install.lock                — install/update mutex
 *   $NDEA_BIN_DIR/ndea                        — symlink → versions/<tag>/ndea (the wrapper)
 *
 * Why a wrapper script: the bun-compiled binary's embedded duckdb.node loads
 * libduckdb.so at runtime, which dyld/ld.so resolves via the binary's
 * directory. On Linux that requires `LD_LIBRARY_PATH`; the wrapper sets it
 * and `exec`s the actual binary with correct signal/TTY semantics.
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

/** `~/.ndea/versions/<tag>/ndea.bin` — the bun-compiled binary inside a version dir. */
export function versionedBinaryPath(tag: string): string {
  return resolve(versionDir(tag), "ndea.bin");
}

/**
 * `~/.ndea/versions/<tag>/ndea` — the POSIX-sh wrapper that sets
 * `LD_LIBRARY_PATH` and execs `ndea.bin`. This is the file the symlink on
 * `$NDEA_BIN_DIR/ndea` points at; users always invoke the wrapper.
 */
export function versionedWrapperPath(tag: string): string {
  return resolve(versionDir(tag), "ndea");
}

/**
 * `~/.ndea/versions/<tag>/libduckdb.<ext>` — sidecar shared library that
 * the embedded `duckdb.node` loads at runtime. Extension matches the host
 * platform (`dylib` on macOS, `so` on Linux).
 */
export function versionedDylibPath(tag: string): string {
  const ext = process.platform === "darwin" ? "dylib" : "so";
  return resolve(versionDir(tag), `libduckdb.${ext}`);
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
  // A compiled single-file binary's execPath points at `ndea.bin` (the
  // wrapper `exec`s it via /bin/sh). Running via `bun run` leaves
  // execPath pointing at `bun` — that's the only basename we exclude.
  const base = exec.split(/[\\/]/).pop() ?? "";
  return !/^bun(\.exe)?$/i.test(base);
}

/**
 * Read `NDEA_LAUNCHER` — the symlink path the user actually invoked.
 *
 * The wrapper (see `wrapper-script.ts`) exports this as `$0` before
 * `exec`ing `ndea.bin`. After exec, `process.execPath` points at the
 * binary, so update / rollback / doctor / gc all need this env var to
 * find the symlink they should manipulate or audit. Returns `undefined`
 * when invoked without the wrapper (e.g. running `ndea.bin` directly).
 */
export function activeLauncher(): string | undefined {
  return process.env.NDEA_LAUNCHER;
}

/**
 * Require `NDEA_LAUNCHER` and exit with a clear error if missing.
 *
 * Used by commands that mutate the install (`update`, `rollback`) — they
 * can't operate sensibly without knowing which symlink to swap.
 */
export function requireActiveLauncher(): string {
  const launcher = activeLauncher();
  if (!launcher) {
    console.error("Error: NDEA_LAUNCHER not set. Invoke `ndea` (the wrapper on PATH), not `ndea.bin` directly.");
    process.exit(1);
  }
  return resolve(launcher);
}
