/**
 * The duckdb-zarr DuckDB extension: which build ndea uses, where it lives, and
 * the one place DuckDB instances are opened with it loaded.
 *
 * duckdb-zarr ships `C_STRUCT_UNSTABLE` builds: each is pinned to one exact
 * DuckDB version, so ndea builds it from source for the installed
 * `@duckdb/node-api` (`scripts/build-zarr-extension.ts`, `vp run build:zarr-ext`)
 * and every DuckDB bump means a rebuild.
 *
 * - Source and dev runs load it from `apps/ndea/.zarr-ext-cache/<key>/`.
 * - The compiled binary embeds it (`__generated-zarr-extension.ts`, written by
 *   `scripts/build.ts`) and extracts it once to the ndea cache dir. `LOAD` reads
 *   a local file, so it works offline.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DuckDBInstance, version as duckdbLibraryVersion } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import { ndeaCacheDir } from "../cli/lib/libduckdb-cache.ts";
import { ZARR_EXTENSION_EMBEDDED_PATH } from "./__generated-zarr-extension.ts";

/** The duckdb-zarr release ndea builds, and the commit its tag points at. */
export const ZARR_EXTENSION = { version: "v0.2.0", commit: "22c9f797259ec36b37edba3690cc2c94d75b6f79" } as const;

/** DuckDB's extension platform string for this host. */
export function duckdbPlatform(platform: string = process.platform, arch: string = process.arch): string {
  const os = platform === "darwin" ? "osx" : platform === "win32" ? "windows" : platform;
  const cpu = arch === "x64" ? "amd64" : arch;
  return `${os}_${cpu}`;
}

/** Cache key of one build: extension version, DuckDB version (`v1.5.6`), platform. */
export function zarrExtensionKey(duckdbVersion: string, platform = duckdbPlatform()): string {
  return `${ZARR_EXTENSION.version}-${duckdbVersion}-${platform}`;
}

/** Source/dev location; `scripts/build-zarr-extension.ts` writes it. */
export function devZarrExtensionPath(duckdbVersion: string = duckdbLibraryVersion()): string {
  const appRoot = resolve(import.meta.dir, "../..");
  return resolve(appRoot, ".zarr-ext-cache", zarrExtensionKey(duckdbVersion), "zarr.duckdb_extension");
}

/**
 * Path of the extension this process loads. A compiled binary extracts its
 * embedded copy on first use; DuckDB derives the init symbol from the file
 * name, so it must stay `zarr.duckdb_extension`.
 */
export async function zarrExtensionPath(): Promise<string> {
  if (ZARR_EXTENSION_EMBEDDED_PATH === null) {
    const path = devZarrExtensionPath();
    if (!existsSync(path)) throw new Error(`duckdb-zarr extension not built: run \`vp run build:zarr-ext\` (${path})`);
    return path;
  }
  const path = resolve(ndeaCacheDir(), zarrExtensionKey(duckdbLibraryVersion()), "zarr.duckdb_extension");
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    // Write beside, then rename: a concurrent start never loads a torn file.
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, await Bun.file(ZARR_EXTENSION_EMBEDDED_PATH).bytes());
    renameSync(tmp, path);
  }
  return path;
}

/** Load the extension on `conn` (the instance must allow unsigned extensions). */
export async function loadZarrExtension(conn: DuckDBConnection): Promise<void> {
  const path = await zarrExtensionPath();
  await conn.run(`LOAD '${path.replace(/'/g, "''")}'`);
}

/** A DuckDB instance + connection with duckdb-zarr loaded. Every ndea DuckDB opens here. */
export async function openDuckDB(
  path = ":memory:",
  options: Record<string, string> = {},
): Promise<{ db: DuckDBInstance; conn: DuckDBConnection }> {
  // ponytail: our own unsigned build; signing needs DuckDB's community key, revisit if upstream ships stable builds.
  const db = await DuckDBInstance.create(path, { ...options, allow_unsigned_extensions: "true" });
  const conn = await db.connect();
  try {
    await loadZarrExtension(conn);
  } catch (error) {
    conn.closeSync();
    db.closeSync();
    throw error;
  }
  return { db, conn };
}
