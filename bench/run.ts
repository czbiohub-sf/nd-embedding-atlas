/**
 * Bench harness (CYCLE workflow, seam B) — measure one (driver × dataset) in an
 * isolated process and append a row to the ledger.
 *
 *   bun run bench/run.ts --driver memory-table --dataset <zarr|parquet> --label <name>
 *
 * Metrics: cold_open_ms (open+ingest+ready), peak_rss_mb (sampled — the
 * scalability number), steady_rss_mb (post-load), duckdb_memory, and an
 * auto-selected query suite (median/max ms over N runs). One process per
 * measurement keeps the RSS peak clean.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DRIVERS } from "./drivers.ts";

const LEDGER = resolve(import.meta.dir, "results/ledger.jsonl");

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

function gitCommit(): string {
  const r = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: import.meta.dir });
  return r.stdout.toString().trim() || "unknown";
}

const rss = () => process.memoryUsage().rss;
const mb = (bytes: number) => Math.round(bytes / 1e6);

interface QueryResult {
  median_ms: number | null;
  max_ms: number | null;
}

/** Run `sql` once to warm, then `runs` timed iterations → median/max ms. */
async function timeQuery(
  conn: { runAndReadAll: (sql: string) => Promise<unknown> },
  sql: string,
  runs: number,
): Promise<QueryResult> {
  try {
    await conn.runAndReadAll(sql); // warm
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      await conn.runAndReadAll(sql);
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    return {
      median_ms: Math.round(samples[Math.floor(samples.length / 2)] * 100) / 100,
      max_ms: Math.round(samples[samples.length - 1] * 100) / 100,
    };
  } catch (err) {
    console.error(`  query failed: ${(err as Error).message}\n    ${sql}`);
    return { median_ms: null, max_ms: null };
  }
}

const NUMERIC_TYPES = new Set([
  "DOUBLE",
  "FLOAT",
  "INTEGER",
  "BIGINT",
  "HUGEINT",
  "SMALLINT",
  "TINYINT",
  "UINTEGER",
  "UBIGINT",
]);
const IDENTITY = new Set(["__row_index__", "__obs_index__"]);

async function pickColumns(conn: {
  runAndReadAll: (sql: string) => Promise<{ getRowObjectsJson: () => Record<string, unknown>[] }>;
}): Promise<{ cat: string | null; num: string | null }> {
  const rows = (await conn.runAndReadAll("DESCRIBE dataset")).getRowObjectsJson();
  let cat: string | null = null;
  let num: string | null = null;
  for (const r of rows) {
    const name = String(r.column_name);
    const type = String(r.column_type);
    if (name.startsWith("__") || IDENTITY.has(name)) continue;
    if (!cat && type === "VARCHAR" && name !== "obs_name") cat = name;
    if (!num && NUMERIC_TYPES.has(type)) num = name;
  }
  return { cat, num };
}

async function main() {
  const driverId = arg("driver", "memory-table");
  const dataset = arg("dataset");
  const label = arg("label", dataset.split("/").pop() ?? dataset);
  const runs = Number(arg("runs", "5"));

  const driver = DRIVERS[driverId];
  if (!driver) throw new Error(`unknown driver: ${driverId} (have: ${Object.keys(DRIVERS).join(", ")})`);

  let peak = rss();
  const sampler = setInterval(() => {
    const r = rss();
    if (r > peak) peak = r;
  }, 25);

  const t0 = performance.now();
  const { store, nObs, nCols } = await driver.build(dataset);
  const coldOpenMs = Math.round(performance.now() - t0);
  // --gc probe: force a full GC after build to distinguish "leaked/retained"
  // from "uncollected" obs Arrow Table before sampling steady RSS.
  if (process.argv.includes("--gc")) Bun.gc(true);
  const steadyRss = rss();

  const { cat, num } = await pickColumns(store.conn);
  const mid = Math.floor(nObs / 2);

  const queries: Record<string, QueryResult> = {};
  queries.count = await timeQuery(store.conn, "SELECT COUNT(*) FROM dataset", runs);
  queries.point = await timeQuery(store.conn, `SELECT * FROM dataset WHERE __row_index__ = ${mid}`, runs);
  if (cat) {
    queries.cat_hist = await timeQuery(
      store.conn,
      `SELECT "${cat}" AS k, COUNT(*) AS n FROM dataset GROUP BY 1 ORDER BY n DESC LIMIT 100`,
      runs,
    );
    queries.filter = await timeQuery(
      store.conn,
      `SELECT COUNT(*) FROM dataset WHERE "${cat}" = (SELECT "${cat}" FROM dataset WHERE "${cat}" IS NOT NULL LIMIT 1)`,
      runs,
    );
  }
  if (num) {
    queries.num_stats = await timeQuery(
      store.conn,
      `SELECT MIN("${num}") a, MAX("${num}") b, AVG("${num}") c FROM dataset`,
      runs,
    );
    queries.num_hist = await timeQuery(
      store.conn,
      `WITH b AS (SELECT MIN("${num}") mn, MAX("${num}") mx FROM dataset)
             SELECT CAST(50 * ("${num}" - mn) / NULLIF(mx - mn, 0) AS INTEGER) AS bin, COUNT(*) AS n
             FROM dataset, b GROUP BY 1 ORDER BY 1`,
      runs,
    );
  }

  let duckdbMemory = "n/a";
  try {
    const r = (await store.conn.runAndReadAll("SELECT memory_usage FROM pragma_database_size()")).getRowObjectsJson();
    const v = r[0]?.memory_usage;
    duckdbMemory = typeof v === "string" ? v : "n/a";
  } catch {
    // pragma may be unavailable for :memory: — leave n/a
  }

  clearInterval(sampler);
  if (rss() > peak) peak = rss();

  const row = {
    ts: new Date().toISOString(),
    commit: gitCommit(),
    driver: driverId,
    dataset: label,
    n_obs: nObs,
    n_cols: nCols,
    cat_col: cat,
    num_col: num,
    cold_open_ms: coldOpenMs,
    peak_rss_mb: mb(peak),
    steady_rss_mb: mb(steadyRss),
    duckdb_memory: duckdbMemory,
    queries,
  };

  mkdirSync(resolve(import.meta.dir, "results"), { recursive: true });
  appendFileSync(LEDGER, `${JSON.stringify(row)}\n`);

  const q = (k: string) => queries[k]?.median_ms ?? "—";
  console.log(
    `[${driverId}] ${label}  n=${nObs.toLocaleString()} cols=${nCols}  ` +
      `open=${coldOpenMs}ms  peakRSS=${mb(peak)}MB  steadyRSS=${mb(steadyRss)}MB  ddb=${duckdbMemory}  ` +
      `count=${q("count")}ms point=${q("point")}ms cat_hist=${q("cat_hist")}ms filter=${q("filter")}ms num_hist=${q("num_hist")}ms`,
  );

  // Force process exit — DuckDB native handles can keep the event loop alive.
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
