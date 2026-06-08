/**
 * Ledger report (CYCLE workflow) — render bench/results/ledger.jsonl as a
 * scannable table. Latest row per (driver × dataset) wins; pass --all to show
 * every run, --baseline <commit> to diff peak_rss/cold_open against a baseline.
 *
 *   bun run bench/report.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const LEDGER = resolve(import.meta.dir, "results/ledger.jsonl");

interface Row {
  ts: string;
  commit: string;
  driver: string;
  dataset: string;
  n_obs: number;
  cold_open_ms: number;
  peak_rss_mb: number;
  steady_rss_mb: number;
  duckdb_memory: string;
  queries: Record<string, { median_ms: number | null }>;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

/** Median ms for a query key, or em-dash if absent. */
function q(r: Row, k: string): string {
  const v = r.queries[k]?.median_ms;
  return v == null ? "—" : String(v);
}

function main() {
  if (!existsSync(LEDGER)) {
    console.log("no ledger yet — run bench/run.ts first");
    return;
  }
  const all = readFileSync(LEDGER, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);

  const showAll = process.argv.includes("--all");
  // Latest per (driver,dataset) unless --all.
  const rows = showAll ? all : [...new Map(all.map((r) => [`${r.driver}:${r.dataset}`, r])).values()];

  rows.sort((a, b) => a.n_obs - b.n_obs || a.driver.localeCompare(b.driver));

  const header = [
    pad("driver", 14),
    pad("dataset", 12),
    padL("n_obs", 10),
    padL("open_ms", 9),
    padL("peakRSS", 9),
    padL("steadyRSS", 10),
    padL("ddb_mem", 12),
    padL("count", 7),
    padL("point", 7),
    padL("cat_hist", 9),
    padL("filter", 8),
    padL("num_hist", 9),
  ].join("  ");
  console.log(header);
  console.log("─".repeat(header.length));

  for (const r of rows) {
    console.log(
      [
        pad(r.driver, 14),
        pad(r.dataset, 12),
        padL(r.n_obs.toLocaleString(), 10),
        padL(String(r.cold_open_ms), 9),
        padL(`${r.peak_rss_mb}MB`, 9),
        padL(`${r.steady_rss_mb}MB`, 10),
        padL(r.duckdb_memory, 12),
        padL(q(r, "count"), 7),
        padL(q(r, "point"), 7),
        padL(q(r, "cat_hist"), 9),
        padL(q(r, "filter"), 8),
        padL(q(r, "num_hist"), 9),
      ].join("  "),
    );
  }
}

main();
