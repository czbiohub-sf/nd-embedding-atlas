/**
 * Location of the libduckdb copy a compiled binary extracts on first run.
 *
 * Shared by the preloader (writes + dlopens it) and `ndea doctor` (reports
 * it) so the two can never disagree about the path.
 *
 * The basename must match what duckdb.node links against: `libduckdb.dylib`
 * on macOS, `libduckdb.so` on Linux, and `duckdb.dll` on Windows, where the
 * DuckDB bindings ship an unprefixed name. That matters beyond cosmetics on
 * Windows: the loader resolves an already-loaded module by basename alone, so
 * a mismatched name means duckdb.node's import misses the preloaded image and
 * falls back to a disk search that finds nothing.
 *
 * Version-scoped so copies don't leak across upgrades, and persistent across
 * OS temp cleans. Honours `XDG_CACHE_HOME` everywhere, then `%LOCALAPPDATA%`
 * on Windows, else `~/.cache`.
 */

import { homedir } from "node:os";
import { resolve } from "node:path";
import { VERSION } from "../version.ts";

/** Full path to the extracted libduckdb for the running version. */
export function libduckdbCachePath(): string {
  const root =
    process.env.XDG_CACHE_HOME ??
    (process.platform === "win32" ? process.env.LOCALAPPDATA : undefined) ??
    resolve(homedir(), ".cache");
  const fileName =
    process.platform === "darwin" ? "libduckdb.dylib" : process.platform === "win32" ? "duckdb.dll" : "libduckdb.so";
  return resolve(root, "ndea", VERSION, fileName);
}
