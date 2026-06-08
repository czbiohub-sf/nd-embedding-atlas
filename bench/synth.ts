/**
 * Synthetic ceiling generator (CYCLE workflow) — tile a real dataset's obs to a
 * target row count and write it as an obs Parquet, so we can measure the 5M/10M
 * scale before a real dataset that big exists.
 *
 *   bun run bench/synth.ts --from <zarr> --rows 5000000 --out bench/synth-5m.parquet
 *
 * Identity columns are dropped on export; `EmbeddingStore.fromParquet` then
 * synthesizes fresh unique `__row_index__`/`obs_name`, so point-lookups and
 * indexes stay valid at scale. The `parquet` driver (drivers.ts) reads the
 * result.
 */

import { statSync } from "node:fs";
import { DRIVERS } from "./drivers.ts";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

async function main() {
  const from = arg("from");
  const rows = Number(arg("rows", "5000000"));
  const out = arg("out");

  console.log(`synth: building source store from ${from} …`);
  const { store, nObs } = await DRIVERS["memory-table"].build(from);

  const k = Math.ceil(rows / nObs);
  console.log(`synth: tiling ${nObs.toLocaleString()} obs ×${k} → ${rows.toLocaleString()} rows`);

  // Drop identity cols so fromParquet re-synthesizes unique ones at scale.
  const sql = `COPY (
        SELECT * EXCLUDE (__row_index__, __obs_index__, obs_name)
        FROM obs_base CROSS JOIN range(0, ${k}) AS _tile(i)
        LIMIT ${rows}
    ) TO '${out}' (FORMAT PARQUET)`;
  const t = performance.now();
  await store.conn.run(sql);
  const ms = Math.round(performance.now() - t);

  const sizeMb = Math.round(statSync(out).size / 1e6);
  console.log(`synth: wrote ${out}  (${sizeMb} MB, ${ms}ms)`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
