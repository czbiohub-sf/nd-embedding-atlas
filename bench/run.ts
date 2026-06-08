/**
 * Bench harness (CYCLE workflow, seam B) — measure one (driver × dataset) in an
 * isolated process. Two modes:
 *
 *   normal:        append a rich row to results/ledger.jsonl + print a summary
 *   --metric NAME: print ONLY that metric's number to stdout (autoresearch Verify)
 *
 * Metrics: memory high-water broken into rss / heap / arrayBuffers / external
 * (peak is the OOM signal; the breakdown attributes which copy a lever kills),
 * cold_open_ms, duckdb_memory_mb, a golden query suite, and a selection/
 * cross-filter latency suite (filter_box, selectivity sweep, rowset/lasso,
 * crossfilter_suite). One process per measurement keeps peaks clean.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DRIVERS } from "./drivers.ts";
import { crossfilterDependents, filterQueries, goldenQueries, pickColumns } from "./queries.ts";

const LEDGER = resolve(import.meta.dir, "results/ledger.jsonl");

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function gitCommit(): string {
  const r = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: import.meta.dir });
  return r.stdout.toString().trim() || "unknown";
}

const mb = (bytes: number) => Math.round(bytes / 1e6);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Parse DuckDB's pragma_database_size memory_usage string ("67.8 MiB") → MB. */
function parseMem(s: string): number {
  const m = /([\d.]+)\s*(KiB|MiB|GiB)?/.exec(s);
  if (!m) return 0;
  const v = Number(m[1]);
  const unit = m[2] ?? "MiB";
  const toMiB = unit === "GiB" ? v * 1024 : unit === "KiB" ? v / 1024 : v;
  return round2(toMiB * 1.048576); // MiB → MB
}

interface ReadConn {
  runAndReadAll: (sql: string) => Promise<{ getRowObjectsJson: () => Record<string, unknown>[] }>;
  run: (sql: string) => Promise<unknown>;
}

/** Median ms over `runs` timed iterations (one warm-up first). */
async function timeMedian(fn: () => Promise<void>, runs: number): Promise<number> {
  await fn(); // warm
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  return round2(samples[Math.floor(samples.length / 2)]);
}

async function main() {
  const driverId = arg("driver", "memory-table");
  const dataset = arg("dataset");
  const label = arg("label", dataset.split("/").pop() ?? dataset);
  const runs = Number(arg("runs", "5"));
  const metricOnly = hasFlag("metric") ? arg("metric") : null;

  const driver = DRIVERS[driverId];
  if (!driver) throw new Error(`unknown driver: ${driverId} (have: ${Object.keys(DRIVERS).join(", ")})`);

  // Peak high-water across the whole run, broken out by allocation kind.
  const peak = { rss: 0, heapUsed: 0, arrayBuffers: 0, external: 0 };
  const sample = () => {
    const m = process.memoryUsage();
    if (m.rss > peak.rss) peak.rss = m.rss;
    if (m.heapUsed > peak.heapUsed) peak.heapUsed = m.heapUsed;
    if (m.arrayBuffers > peak.arrayBuffers) peak.arrayBuffers = m.arrayBuffers;
    if (m.external > peak.external) peak.external = m.external;
  };
  sample();
  const sampler = setInterval(sample, 25);

  const t0 = performance.now();
  const { store, nObs, nCols } = await driver.build(dataset);
  const coldOpenMs = Math.round(performance.now() - t0);
  if (hasFlag("gc")) Bun.gc(true);
  sample();

  const conn = store.conn as unknown as ReadConn;
  const cols = await pickColumns(conn);

  const metrics: Record<string, number> = {};

  // ── Golden suite (timed; results are the correctness guard, see verify.ts) ──
  for (const q of goldenQueries(cols, nObs)) {
    metrics[`q_${q.name}_ms`] = await timeMedian(async () => {
      await conn.runAndReadAll(q.sql);
    }, runs);
  }

  // ── Selection / cross-filter latency suite ─────────────────────────────────
  for (const q of filterQueries(cols)) {
    metrics[`${q.name}_ms`] = await timeMedian(async () => {
      await conn.runAndReadAll(q.sql);
    }, runs);
  }

  // crossfilter_suite_ms — all dependent aggregates under one ~1% predicate.
  const deps = crossfilterDependents(cols);
  if (deps.length > 0) {
    metrics.crossfilter_suite_ms = await timeMedian(async () => {
      for (const q of deps) await conn.runAndReadAll(q.sql);
    }, runs);
  }

  // filter_rowset_ms — the lasso path: create a ~1% row-id temp table, aggregate
  // joined to it, drop. Models the per-selection __scatter_selection churn.
  const stride = Math.max(1, Math.floor(nObs / Math.max(1, Math.round(nObs * 0.01))));
  const rowsetAgg = cols.cat
    ? `SELECT COUNT(*) c, COUNT(DISTINCT d."${cols.cat}") k FROM dataset d JOIN __bench_sel s USING (__row_index__)`
    : "SELECT COUNT(*) c FROM dataset d JOIN __bench_sel s USING (__row_index__)";
  metrics.filter_rowset_ms = await timeMedian(async () => {
    await conn.run(
      `CREATE TEMP TABLE __bench_sel AS SELECT __row_index__ FROM dataset WHERE __row_index__ % ${stride} = 0`,
    );
    await conn.runAndReadAll(rowsetAgg);
    await conn.run("DROP TABLE __bench_sel");
  }, runs);

  // ── DuckDB native footprint ─────────────────────────────────────────────────
  let duckdbMemMb = 0;
  try {
    const r = (await conn.runAndReadAll("SELECT memory_usage FROM pragma_database_size()")).getRowObjectsJson();
    const v = r[0]?.memory_usage;
    if (typeof v === "string") duckdbMemMb = parseMem(v);
  } catch {
    // pragma may be unavailable for :memory: — leave 0
  }

  clearInterval(sampler);
  sample();

  metrics.peak_rss_mb = mb(peak.rss);
  metrics.peak_heap_mb = mb(peak.heapUsed);
  metrics.peak_arraybuffers_mb = mb(peak.arrayBuffers);
  metrics.peak_external_mb = mb(peak.external);
  metrics.cold_open_ms = coldOpenMs;
  metrics.duckdb_memory_mb = duckdbMemMb;

  // ── --metric mode: bare number for autoresearch Verify ──────────────────────
  if (metricOnly) {
    const v = metrics[metricOnly];
    if (v === undefined) {
      console.error(`unknown metric "${metricOnly}". have: ${Object.keys(metrics).join(", ")}`);
      process.exit(1);
    }
    console.log(v);
    process.exit(0);
  }

  // ── Normal mode: append rich row + print summary ────────────────────────────
  const row = {
    ts: new Date().toISOString(),
    commit: gitCommit(),
    driver: driverId,
    dataset: label,
    n_obs: nObs,
    n_cols: nCols,
    cat_col: cols.cat,
    num_col: cols.num,
    metrics,
  };
  mkdirSync(resolve(import.meta.dir, "results"), { recursive: true });
  appendFileSync(LEDGER, `${JSON.stringify(row)}\n`);

  console.log(
    `[${driverId}] ${label}  n=${nObs.toLocaleString()} cols=${nCols}\n` +
      `  mem  peakRSS=${metrics.peak_rss_mb}MB  heap=${metrics.peak_heap_mb}MB  arrayBuf=${metrics.peak_arraybuffers_mb}MB  ext=${metrics.peak_external_mb}MB  ddb=${metrics.duckdb_memory_mb}MB  open=${coldOpenMs}ms\n` +
      `  query  count=${metrics.q_count_ms} cat_hist=${metrics.q_cat_hist_ms} num_hist=${metrics.q_num_hist_ms}\n` +
      `  filter box=${metrics.filter_box_ms} rowset=${metrics.filter_rowset_ms} xf_suite=${metrics.crossfilter_suite_ms}  sel[0.1/1/10/50]=${metrics.filter_sel_0p1_ms}/${metrics.filter_sel_1_ms}/${metrics.filter_sel_10_ms}/${metrics.filter_sel_50_ms}`,
  );

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
