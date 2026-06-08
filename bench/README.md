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
# Measure one (driver × dataset) → appends a rich row to the ledger
bun run bench/run.ts --driver memory-table --dataset <zarr|parquet> --label <name>

# Emit ONE metric as a bare number (autoresearch Verify command)
bun run bench/run.ts --driver memory-table --dataset <zarr> --metric peak_rss_mb

# Correctness guard: golden queries identical baseline-vs-candidate (autoresearch Guard)
bun run bench/verify.ts --baseline memory-table --candidate stream-table --dataset <zarr>

# Synthesize a ceiling obs parquet
bun run bench/synth.ts --from <zarr> --rows 5000000 --out bench/synth-5m.parquet

# Render the ledger
bun run bench/report.ts            # memory view (latest per driver × dataset)
bun run bench/report.ts --filter   # selection/cross-filter latency view
bun run bench/report.ts --all      # every run
```

## Seams

- **`drivers.ts`** — the swappable I/O backend. Each lever = one `BenchDriver`
  built the same way real startup builds the store, so measurements are genuine.
  Handles AnnData **and** MuData.
- **`queries.ts`** — one source of SQL for `run.ts` (timing) and `verify.ts`
  (correctness): `goldenQueries` (deterministic, compared across drivers),
  `filterQueries` + `crossfilterDependents` (selection-latency suite).
- **`run.ts`** — `--metric NAME` emits a bare number (autoresearch Verify);
  normal mode appends a rich row + prints a summary.
- **`verify.ts`** — runs the golden suite on baseline vs candidate, exits
  non-zero on any result mismatch (autoresearch Guard).
- **`results/ledger.jsonl`** — committed record; cycles append.

## Measurable surface (the numbers a loop can chase)

**Memory (targets) — peak high-water, broken out so a win is _attributable_:**
`peak_rss_mb` (all-in, the OOM signal) · `peak_heap_mb` (JS objects/**strings** —
catches the categorical decode-to-string blowup) · `peak_arraybuffers_mb`
(TypedArray + flechette Arrow buffers) · `peak_external_mb`/`duckdb_memory_mb`
(native DuckDB). Skipping the Arrow table should drop `arrayBuffers`;
dict-encoding categoricals should drop `heap`; file-backed drops `external`.

**Selection / cross-filter latency (the felt interactivity at 5-10M):**
`crossfilter_suite_ms` (dependent aggregates under one ~1% predicate — the
round-trip) · `filter_box_ms` (brush window) · `filter_rowset_ms` (lasso /
`__scatter_selection` temp-table path) · `filter_sel_{0p1,1,10,50}_ms`
(selectivity sweep). Time: `cold_open_ms`.

**Guards (quality floor):** `golden_query_mismatches = 0` (verify.ts exit code) ·
`query p95 ≤ budget` · `vp check` green.

→ Two autoresearch loops fall out: **(A) ingest-memory** — target `peak_rss_mb @1M`
(↓), guard = verify.ts + `vp check`; **(B) filter-latency** — target
`crossfilter_suite_ms @5M` (↓), lever = preagg/density/pushdown, same guard.

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

## Research synthesis (2026-06-07) — concrete targets folded in

Deep-research pass (19 confirmed claims, primary sources) validated the loop's
direction and sharpened it:

- **Bounded chunk-streaming is the fix, and it's language-independent** (X100,
  CIDR'05: process cache-resident vectors, not full columns → peak O(chunk)).
- **Batch target ≥ 122,880 rows** (DuckDB row-group = 2048×60) for fast insert.
- **Don't switch to Arrow/ADBC for throughput** — "ADBC beats Appender" (0-3) and
  "ADBC 38× ODBC" (1-2) were REFUTED; "zero-copy = no copy" overreached. The
  Appender is fine; the win is the streaming _producer_, not Appender-vs-Arrow.
- **Keep categoricals dictionary-encoded end-to-end** — `convertCategorical`
  (data-frame.ts) decoding codes → full `(string|null)[]` is a needless copy.
- **Don't rewrite DuckDB** — out-of-core hash aggregation degrades gracefully
  (ICDE'24; sole engine to finish TPC-H SF128 in 32GB). Validates Cycle 1a's
  file-backed + read_parquet + pushdown. Cross-filter = late-materialization
  regime (Abadi ICDE'07).
- **Rust: DEFER** (research-backed, medium conf). napi-rs (zarrs+arrow-rs+duckdb
  crate + native ArrowArrayStream) is sound but the win is the streaming
  discipline, not the language; a 2nd non-cross-compilable native artifact on
  duckdb.node + per-platform builds + FFI + eroding single-binary/shared-Zod
  dominate. Revisit ONLY if the experiment below shows decode CPU as the wall —
  and even then a worker-pool TS decode before a native artifact.

**The decisive experiment (settles Rust):** after streaming-TS ingest, does peak
RSS @1M drop near DuckDB's footprint, OR does zarrita decode itself
(decompression + CSR-sparse reconstruction) stay multi-copy? Cycle 3's
measurement IS the Rust gate.

**Cycle 3 feasibility unknown:** can flechette emit incremental record batches /
an ArrowArrayStream to duckdb-node, or does the JS path force a full-table build?
(Arrow C-Stream bounds peak only if the producer streams without a full table.)

**Two adjacent levers (added to backlog):**

7. **Server-side density binning** (datashader): DuckDB `GROUP BY floor(x/binW),
floor(y/binH)` over the active predicate → fixed-size grid → WebGPU heatmap.
   Row-count-independent; back-stops per-point GPU at 5-10M (folds into WBOIT).
8. **Data-virtualized table** (pierre "slice-first" `getVisibleSlice`): fetch only
   the visible row range from DuckDB, never client-materialize all rows. We have
   the windowing half (TanStack Virtual); verify the data half at scale.

## Cycle 3 — streaming ingest (append from source, no Arrow table) ✅

`ingestDataFramesStreaming` (duckdb-ingest.ts) feeds the DuckDB Appender directly
from `AnnDataFrame` source columns, skipping the intermediate flechette Arrow
Table and keeping categoricals **code-encoded** (the category string is looked
up per row, never materialized as a JS array). Driver: `stream-table` (:memory:,
so the delta vs `memory-table` is purely the ingest path).

| driver           | n_obs | open     | peak RSS    | heap       | arrayBuf  | ddb    |
| ---------------- | ----- | -------- | ----------- | ---------- | --------- | ------ |
| memory-table     | 1M    | 10.7s    | 5365 MB     | 1420 MB    | 848 MB    | 889 MB |
| **stream-table** | 1M    | **6.1s** | **2679 MB** | **158 MB** | **75 MB** | 889 MB |

**Result: peak RSS −50%, JS heap −89%, arrayBuffers −91%, open −46% at 1M** —
identical query/filter latency, **0 golden-query mismatches** (verify.ts, at 93k
and 1M). The JS ingest cost collapsed from ~2.2 GB to ~233 MB; the residual is
DuckDB-native (889 MB), which Cycle 1a's file-backed driver pages → they stack.

**Answers the Rust question** (the research's decisive experiment): after
streaming-TS, the JS side drops near DuckDB's footprint — zarrita decode did NOT
remain a multi-copy wall → **Rust is not needed for ingest.**

**Bug fix (the harness earned its keep):** the golden guard caught
`is_primary_data` (a boolean obs column) coming out `""` — flechette's `utf8()`
builder silently empties non-strings. Fixed in `data-frame.ts convertColumn`
(stringify plain-array elements before flechette) so BOTH paths preserve it;
verify then passes 0. Plain-array obs columns (booleans) were silently dropped
in production before this.

**Next:** combine stream-table + file-backed (page the residual 889 MB DuckDB);
then `/autoresearch:plan`→`/autoresearch` to sweep tuning knobs (guard =
stream-vs-snapshot via verify.ts). And the filter-latency loop (preagg/density)
for crossfilter_suite at 5-10M.
