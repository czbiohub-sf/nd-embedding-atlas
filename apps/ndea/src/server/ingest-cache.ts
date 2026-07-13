/**
 * Ingest mode + file-backed ingest cache (I/O-scalability loop `perf/io-scalability`).
 *
 * The startup ingest path runs in one of three modes (env `NDEA_INGEST`):
 *   - `chunked` (default) — single-AnnData obs/var stream from the zarr source
 *     in row-windows (`ingestDataFrameChunked`); peak JS allocation is one
 *     batch, scale-invariant to 5-10M obs. Multi-dataset unions fall back to
 *     `stream` (chunked can't emit the `_dataset` discriminator column).
 *   - `stream` — `ingestDataFramesStreaming` (no intermediate Arrow table) for
 *     every dataset.
 *   - `eager` — the original `ingestDataFrames` (flechette Arrow Table) path,
 *     `:memory:`, no cache. The instant-revert escape hatch.
 *
 * Non-`eager` local ingests are file-backed and cached: base tables page to a
 * content-keyed `.duckdb` under `~/.cache/ndea/ingest/`, so reopening the same
 * dataset skips re-ingest. `NDEA_NO_INGEST_CACHE=1` forces a fresh `:memory:`
 * build. The cache root reuses the version-scoped libduckdb cache expression.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { cpus, homedir, tmpdir } from "node:os";
import { resolve } from "node:path";

export type IngestMode = "eager" | "stream" | "chunked";

/** Resolve the ingest mode from `NDEA_INGEST` (default `chunked`). */
export function resolveIngestMode(): IngestMode {
  const v = process.env.NDEA_INGEST?.toLowerCase();
  if (v === "eager" || v === "stream" || v === "chunked") return v;
  return "chunked";
}

/** A dataset path is local (cacheable) unless it's an http(s) zarr store. */
export function isLocalPath(path: string): boolean {
  return !/^https?:\/\//i.test(path);
}

/**
 * DuckDB PRAGMAs for the file-backed ingest store. `threads` = cpu//2.
 * `NDEA_MEMORY_LIMIT` (e.g. `4GB`) caps the buffer pool to force out-of-core
 * paging of the file-backed base tables; unset = DuckDB default (~80% RAM),
 * which keeps query latency unconstrained but yields less resident-memory
 * relief. Tuned via the bench loop.
 */
export function ingestPragmas(): { memoryLimit?: string; tempDirectory?: string; threads?: number } {
  const threads = Math.max(1, Math.floor(cpus().length / 2));
  const memoryLimit = process.env.NDEA_MEMORY_LIMIT?.length ? process.env.NDEA_MEMORY_LIMIT : undefined;
  return memoryLimit ? { memoryLimit, tempDirectory: tmpdir(), threads } : { threads };
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
 * full per-chunk content hash (that would defeat the skip-re-ingest goal — the
 * ingest pipeline is the documented wall). Stale-but-same-stat chunk edits are
 * the known gap; `NDEA_NO_INGEST_CACHE=1` is the escape hatch.
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
 * a new build invalidates old caches), the ingest mode (different obs_base
 * provenance), the hidden-column set (changes the dataset VIEW), and every
 * member dataset's name + path + zarr fingerprint (ANY member change → miss,
 * and multi-dataset unions key differently from single because of `_dataset`).
 */
export function ingestCacheKey(
  version: string,
  members: readonly { name: string; path: string }[],
  mode: IngestMode,
  hidden: ReadonlySet<string>,
): string {
  const seed = JSON.stringify({
    v: version,
    mode,
    hidden: [...hidden].toSorted(),
    members: members.map((m) => ({ name: m.name, path: m.path, fp: fingerprintZarr(m.path) })),
  });
  return sha256Hex(seed).slice(0, 16);
}
