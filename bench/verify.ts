/**
 * Correctness guard (CYCLE workflow) — the quality floor that makes optimizing a
 * memory/latency number SAFE. Runs the golden query suite on a baseline driver
 * and a candidate driver over the same dataset and asserts identical results;
 * a memory "win" that drops/corrupts data fails here and gets reverted.
 *
 *   bun run bench/verify.ts --baseline memory-table --candidate stream-table --dataset <zarr>
 *
 * Prints the mismatch count and exits non-zero if > 0 (so it works as an
 * autoresearch Guard: "must always pass").
 */

import { DRIVERS } from "./drivers.ts";
import { goldenQueries, pickColumns } from "./queries.ts";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

interface ReadConn {
  runAndReadAll: (sql: string) => Promise<{ getRowObjectsJson: () => Record<string, unknown>[] }>;
}

async function results(driverId: string, dataset: string) {
  const driver = DRIVERS[driverId];
  if (!driver) throw new Error(`unknown driver: ${driverId}`);
  const { store, nObs } = await driver.build(dataset);
  const conn = store.conn as unknown as ReadConn;
  const cols = await pickColumns(conn);
  const out = new Map<string, string>();
  for (const q of goldenQueries(cols, nObs)) {
    const rows = (await conn.runAndReadAll(q.sql)).getRowObjectsJson();
    out.set(q.name, JSON.stringify(rows));
  }
  return out;
}

async function main() {
  const baseline = arg("baseline", "memory-table");
  const candidate = arg("candidate");
  const dataset = arg("dataset");

  // Sequential (not parallel) — each driver build is memory-heavy at scale.
  const base = await results(baseline, dataset);
  const cand = await results(candidate, dataset);

  let mismatches = 0;
  for (const [name, baseJson] of base) {
    const candJson = cand.get(name);
    if (candJson === baseJson) {
      console.log(`  ✓ ${name}`);
    } else {
      mismatches++;
      console.log(`  ✗ ${name} — DIFFERS`);
      console.log(`      baseline:  ${baseJson.slice(0, 200)}`);
      console.log(`      candidate: ${(candJson ?? "<missing>").slice(0, 200)}`);
    }
  }

  console.log(`golden_query_mismatches=${mismatches} (${baseline} vs ${candidate})`);
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
