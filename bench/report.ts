/**
 * Ledger report (CYCLE workflow) — render bench/results/ledger.jsonl. Latest row
 * per (driver × dataset) unless --all. Two views: memory (default) and
 * --filter (selection/cross-filter latency).
 *
 *   bun run bench/report.ts            # memory view, latest per driver×dataset
 *   bun run bench/report.ts --filter   # selection/filter latency view
 *   bun run bench/report.ts --all      # every run
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const LEDGER = resolve(import.meta.dir, "results/ledger.jsonl");

interface Row {
  driver: string;
  dataset: string;
  n_obs: number;
  metrics: Record<string, number>;
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const padL = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);

function cell(r: Row, key: string, suffix = ""): string {
  const v = r.metrics?.[key];
  return v == null ? "—" : `${v}${suffix}`;
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
    .map((l) => JSON.parse(l) as Row)
    .filter((r) => r.metrics); // skip pre-schema rows

  const rows = process.argv.includes("--all")
    ? all
    : [...new Map(all.map((r) => [`${r.driver}:${r.dataset}`, r])).values()];
  rows.sort((a, b) => a.n_obs - b.n_obs || a.driver.localeCompare(b.driver));

  const filterView = process.argv.includes("--filter");
  const cols: [string, string, string][] = filterView
    ? [
        ["xf_suite", "crossfilter_suite_ms", "ms"],
        ["box", "filter_box_ms", "ms"],
        ["rowset", "filter_rowset_ms", "ms"],
        ["sel0.1", "filter_sel_0p1_ms", ""],
        ["sel1", "filter_sel_1_ms", ""],
        ["sel10", "filter_sel_10_ms", ""],
        ["sel50", "filter_sel_50_ms", ""],
      ]
    : [
        ["open_ms", "cold_open_ms", ""],
        ["peakRSS", "peak_rss_mb", "MB"],
        ["heap", "peak_heap_mb", "MB"],
        ["arrayBuf", "peak_arraybuffers_mb", "MB"],
        ["ext", "peak_external_mb", "MB"],
        ["ddb", "duckdb_memory_mb", "MB"],
      ];

  const head = [pad("driver", 14), pad("dataset", 12), padL("n_obs", 10), ...cols.map(([h]) => padL(h, 10))].join("  ");
  console.log(head);
  console.log("─".repeat(head.length));
  for (const r of rows) {
    console.log(
      [
        pad(r.driver, 14),
        pad(r.dataset, 12),
        padL(r.n_obs.toLocaleString(), 10),
        ...cols.map(([, key, suf]) => padL(cell(r, key, suf), 10)),
      ].join("  "),
    );
  }
}

main();
