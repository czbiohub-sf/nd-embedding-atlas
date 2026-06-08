# I/O scalability bench — the measure→drive→measure loop

Goal: scale the backend I/O to **5–10M obs** without holding everything in
`:memory:` DuckDB. This harness is the measurement half of an iterative cyclic
workflow: each cycle picks **one lever**, implements it behind a swappable
driver, measures it against this corpus, and diffs the result against the
committed ledger before accepting.

## The loop

```
0. BASELINE      run harness on current main → ledger      (done — Cycle 0)
1. HYPOTHESIZE   pick one lever; predict the metric move
2. BUILD         implement as a driver (+ API delta if needed)
3. MEASURE       harness across corpus tiers (inner → stress → ceiling)
4. DIFF          vs baseline ledger; check gates
5. DECIDE        accept (new baseline) / revert / iterate
6. RECORD        ledger + dex finding + driver/API update           ↺
```

Branch: `perf/io-scalability` off `main`. **Backend-only** — frontend untouched.

## Corpus (CXG test data, `../ome-atlas-test-data/cxg-data/`)

| tier       | dataset                | n_obs | role         |
| ---------- | ---------------------- | ----- | ------------ |
| inner-loop | `3a641906`             | 93k   | fast iterate |
| —          | `8840342c`             | 134k  |              |
| —          | `b4245b7b`             | 228k  |              |
| stress     | `86a284b2`             | 1M    | real-scale   |
| ceiling    | `synth-5m` (synthetic) | 5M    | target scale |

All real datasets are zarr v3, CSR-sparse X, columnar obs. The 5–10M ceiling is
synthesized by tiling a real obs N× (`synth.ts`) — it measures the ingest/storage
**mechanism** at row-count, not realistic data entropy (tiled rows compress
hard), so read query/memory numbers at the ceiling as a mechanism signal.

## Commands

```bash
# Measure one (driver × dataset) in an isolated process → appends to ledger
bun run bench/run.ts --driver memory-table --dataset <zarr|parquet> --label <name>

# Synthesize a ceiling obs parquet
bun run bench/synth.ts --from <zarr> --rows 5000000 --out bench/synth-5m.parquet

# Render the ledger
bun run bench/report.ts            # latest per (driver × dataset)
bun run bench/report.ts --all      # every run
```

## Seams

- **`drivers.ts`** — the swappable I/O backend. Each lever = one `BenchDriver`
  built the same way real startup builds the store, so measurements are genuine.
  Handles AnnData **and** MuData. Cycle 1 converges this with a production
  `ObsBackend` param on `EmbeddingStore` when the file-backed driver lands.
- **`run.ts`** — measures `cold_open_ms`, `peak_rss_mb` (sampled — the
  scalability number), `steady_rss_mb`, `duckdb_memory`, and an auto-selected
  query suite (categorical histogram, point lookup, numeric stats/histogram,
  cross-filter predicate; median/max ms). One process per measurement.
- **`results/ledger.jsonl`** — committed baseline record; cycles append.

## Gates (each accepted change must pass)

- **Correctness** — golden-query results identical across drivers (lazy/out-of-core must not change answers).
- **Perf** — `peak_rss ≤ budget` at stress; `query p95 ≤ budget`.
- `vp check` + `bun test` green.

## Lever backlog (ranked)

0. ✅ **baseline** — `memory-table` (zarr→JS Arrow→`:memory:`) + `parquet` (fromParquet→`:memory:`).
1. **file-backed DuckDB** + `memory_limit`/`temp_directory`/`threads` PRAGMAs.
2. **`read_parquet` views** + split immutable bulk from derived cols, sidecar sorted by `__row_index__`.
3. **DuckDB Arrow zero-copy** via `arrow_scan`/ADBC (skip the IPC round-trip).
4. **DuckDB replacement scan** over lazy zarr columns — DuckDB-directly-on-AnnData without a C++ extension.
5. **lazy column projection** — only wire obs columns the views reference.
6. **napi-rs / `bun:ffi` Rust zarr codec** — only if decode is profiled as the wall.

## Cycle 0 baseline findings (2026-06-07, commit on `perf/io-scalability`)

| driver       | dataset  | n_obs | open  | peak RSS | DuckDB mem | cat_hist |
| ------------ | -------- | ----- | ----- | -------- | ---------- | -------- |
| memory-table | 3a641906 | 93k   | 0.9s  | 845 MB   | 68 MiB     | 3.5ms    |
| memory-table | 8840342c | 134k  | 1.2s  | 1.0 GB   | 102 MiB    | 3.4ms    |
| memory-table | b4245b7b | 228k  | 1.9s  | 1.3 GB   | 144 MiB    | 4.4ms    |
| memory-table | 86a284b2 | 1M    | 11.3s | 4.7 GB   | 848 MiB    | 7.0ms    |
| parquet      | synth-5m | 5M    | 1.1s  | 3.4 GB   | 3.0 GiB    | 6.7ms    |

**Findings that steer the loop:**

1. **The wall is ingest, not DuckDB, and not query.** At 1M via zarr, peak RSS is
   4.7 GB while DuckDB holds only 848 MiB — ~3.9 GB is the JS pipeline (zarrita
   decode + flechette Arrow + obs held in JS). Queries stay sub-7ms at every scale.
2. **Parquet ingest dwarfs the zarr→JS path.** 5M rows via Parquet: 1.1s open,
   peak RSS ≈ DuckDB's resident set (no JS Arrow blow-up). 1M via zarr: 11.3s.
   → DuckDB reading columnar files directly is the efficient path.
3. **Implications for levers:** Tier 0 (file-backed) only addresses DuckDB's
   share (<20% of RSS at 1M) — necessary but not sufficient. The dominant win is
   **not materializing obs in JS** — i.e., Tier 1/2 (a Parquet sidecar DuckDB
   reads directly, ideally as a `read_parquet` VIEW so it never materializes at
   all). Cycle 1 should pair file-backed DuckDB **with** the sidecar path, not
   file-backed alone.

## Cycle 1a — file-backed DuckDB + memory_limit (`StoreOpenOptions` seam)

Added a backward-compatible `dbPath`/`pragmas` option to `EmbeddingStore`
factories (default `:memory:` unchanged). New drivers `file-table` /
`parquet-file` open a temp `.duckdb` with `memory_limit='1GB'`.

| driver           | dataset  | n_obs | open  | peak RSS    | DuckDB mem |
| ---------------- | -------- | ----- | ----- | ----------- | ---------- |
| memory-table     | 86a284b2 | 1M    | 11.3s | 4726 MB     | 848 MiB    |
| **file-table**   | 86a284b2 | 1M    | 12.7s | **4682 MB** | **67 MiB** |
| parquet          | synth-5m | 5M    | 1.1s  | 3402 MB     | 3.0 GiB    |
| **parquet-file** | synth-5m | 5M    | 5.8s  | **615 MB**  | 113 MiB    |

**Verdict — confirms the Cycle 0 thesis, decisively:**

- **zarr path: REJECTED as a standalone fix.** file-backed cut DuckDB's resident
  memory 848→67 MiB (it pages) but peak RSS barely moved (4726→4682 MB) — the
  ~3.9 GB JS ingest pipeline is untouched.
- **parquet path: out-of-core works.** 5M peak RSS 3402→615 MB (**5.5×**) under a
  1 GB cap, cost ~5× slower open (paging). So file-backed is the right
  _substrate_ once data is columnar-on-disk — useless while JS ingest dominates.
- **The `StoreOpenOptions` seam is kept** (the out-of-core substrate); file-backed
  alone is not the win. → **Cycle 2 attacks the JS ingest pipeline directly:**
  stream the zarr→columnar transcode so peak JS memory is O(batch), not O(all
  obs), then read_parquet view + file-backed.

## Cycle 2 — diagnose the JS ingest peak (measurement cycle, no accepted code)

Two findings, both steering Cycle 3:

1. **RSS is sticky — `steady_rss` is not a leak signal.** A forced `Bun.gc(true)`
   after build (the `--gc` flag on run.ts) left steady RSS unchanged at 1M
   (4701 MB). JSC/Bun frees the JS heap but does not return pages to the OS, so
   steady ≈ peak regardless of liveness. **The metric that matters is the peak
   allocation high-water** — that's what OOMs at 5–10M. Release/GC tricks can't
   lower a high-water that already happened.
2. **The peak is multiple coexisting full copies** in `ingestDataFrames`
   (`duckdb-ingest.ts`) → `df.toArrow()` (`data-frame.ts`): the zarr-decoded
   `AnnDataFrame` source, the per-column conversions (`convertCategorical` even
   **decodes** categoricals back to full `(string|null)[]` arrays — undoing
   AnnData's compact codes), and the flechette Arrow Table — all live at once
   before the DuckDB Appender drains them.

**Key realization:** the Appender appends **per-row values** and never needs the
Arrow Table — it could read straight from the source columns. → **Cycle 3:
`ingestDataFrameStreaming` — feed the Appender directly from `AnnDataFrame`
source columns (apply the per-type conversion inline per value), skipping the
whole intermediate Arrow Table.** Eliminates one full coexisting copy with no
lazy-zarr work. Gate: golden queries identical to baseline; peak_rss ↓ at 1M.
Later sub-levers: keep categoricals dict-encoded (avoid the string-decode
blow-up); batch/lazy per-column zarr reads to bound the source copy too.
