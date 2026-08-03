/**
 * Ingest strategy + file-backed ingest cache (I/O-scalability loop
 * `perf/io-scalability`).
 *
 * A single AnnData streams obs/var from the zarr source in row-windows
 * (`ingestDataFrameChunked`), so peak JS allocation is one batch and stays
 * scale-invariant to 5-10M obs. Multi-dataset unions fall back to `streaming`,
 * which can emit the `_dataset` discriminator column that chunked cannot.
 *
 * Local AnnData ingests are file-backed and cached: base tables page to a
 * content-keyed `.duckdb` under `~/.cache/ndea/ingest/`, so reopening the same
 * dataset skips re-ingest. The cache root reuses the version-scoped libduckdb
 * cache expression.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { resolve } from "node:path";

/** How obs_base/var_base were produced. Derived, not user-selectable. */
export type IngestStrategy = "mudata" | "chunked" | "streaming";

/** A dataset path is local (cacheable) unless it's an http(s) zarr store. */
export function isLocalPath(path: string): boolean {
  return !/^https?:\/\//i.test(path);
}

/**
 * DuckDB PRAGMAs for the file-backed ingest store. `threads` = cpu//2; memory
 * uses DuckDB's default.
 */
export function ingestPragmas(): { threads: number } {
  const threads = Math.max(1, Math.floor(cpus().length / 2));
  return { threads };
}

/** `~/.cache/ndea/ingest/<key>.duckdb` (honours `XDG_CACHE_HOME`). */
export function resolveIngestCachePath(key: string): { cacheDir: string; dbPath: string } {
  const cacheRoot = process.env.XDG_CACHE_HOME ?? resolve(homedir(), ".cache");
  const cacheDir = resolve(cacheRoot, "ndea", "ingest");
  return { cacheDir, dbPath: resolve(cacheDir, `${key}.duckdb`) };
}

function sha256Hex(input: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(input);
  return hasher.digest("hex");
}

/**
 * Cheap staleness fingerprint of a zarr store: size+mtime of the schema-
 * defining metadata files, plus a content hash of the root group metadata so
 * an in-place schema rewrite that preserves size+mtime still misses. NOT a
 * full per-chunk content hash (that would defeat the skip-re-ingest goal: the
 * ingest pipeline is the documented wall). Stale-but-same-stat chunk edits are
 * the known gap.
 */
function fingerprintZarr(absPath: string): string {
  const parts: string[] = [];
  const candidates = [
    "zarr.json",
    ".zattrs",
    ".zgroup",
    "obs/zarr.json",
    "obs/.zattrs",
    "obs/.zgroup",
    "var/zarr.json",
    "var/.zattrs",
    "var/.zgroup",
  ];
  for (const rel of candidates) {
    const file = resolve(absPath, rel);
    if (!existsSync(file)) continue;
    const st = statSync(file);
    parts.push(`${rel}|${st.size}|${st.mtimeMs}`);
    if (rel === "zarr.json" || rel === ".zattrs") {
      parts.push(`${rel}#${sha256Hex(readFileSync(file, "utf8")).slice(0, 16)}`);
    }
  }
  return parts.join(";");
}

/**
 * Content key for the ingest cache. Folds in: ndea VERSION (a schema change in
 * a new build invalidates old caches), the ingest strategy (different obs_base
 * provenance), the hidden-column set (changes the dataset VIEW), and every
 * member dataset's name + path + zarr fingerprint (ANY member change → miss,
 * and multi-dataset unions key differently from single because of `_dataset`).
 */
export function ingestCacheKey(
  version: string,
  members: readonly { name: string; path: string }[],
  strategy: IngestStrategy,
  hidden: ReadonlySet<string>,
): string {
  const seed = JSON.stringify({
    v: version,
    strategy,
    hidden: [...hidden].toSorted(),
    members: members.map((m) => ({ name: m.name, path: m.path, fp: fingerprintZarr(m.path) })),
  });
  return sha256Hex(seed).slice(0, 16);
}
