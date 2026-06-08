/**
 * Shared query builders (CYCLE workflow) — one source of SQL so run.ts (timing)
 * and verify.ts (correctness) measure the SAME queries.
 *
 *   golden*    deterministic-result queries — timed AND compared across drivers
 *              (the correctness guard: identical results = ingest didn't corrupt).
 *   filter*    selection/cross-filter latency suite (the felt interactivity at
 *              5-10M). Deterministic via quantiles so they double as correctness.
 *
 * Columns are auto-selected by type so the suite is dataset-agnostic.
 */

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

export interface PickedCols {
  cat: string | null;
  num: string | null;
}

export interface NamedQuery {
  name: string;
  sql: string;
}

interface ReadableConn {
  runAndReadAll: (sql: string) => Promise<{ getRowObjectsJson: () => Record<string, unknown>[] }>;
}

/** Pick a representative categorical (VARCHAR) and numeric column from `dataset`. */
export async function pickColumns(conn: ReadableConn): Promise<PickedCols> {
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

/**
 * Deterministic-result queries. Ordered (with tie-breaks) so results are
 * byte-stable across drivers — the golden set the correctness guard compares.
 */
export function goldenQueries(cols: PickedCols, nObs: number): NamedQuery[] {
  const mid = Math.floor(nObs / 2);
  const qs: NamedQuery[] = [
    { name: "count", sql: "SELECT COUNT(*) AS c FROM dataset" },
    { name: "point", sql: `SELECT * FROM dataset WHERE __row_index__ = ${mid}` },
    {
      name: "identity",
      sql: `SELECT __row_index__, obs_name FROM dataset WHERE __row_index__ IN (0, ${mid}, ${Math.max(0, nObs - 1)}) ORDER BY __row_index__`,
    },
  ];
  if (cols.cat) {
    qs.push({
      name: "cat_hist",
      sql: `SELECT "${cols.cat}" AS k, COUNT(*) AS n FROM dataset GROUP BY 1 ORDER BY n DESC, k LIMIT 100`,
    });
  }
  if (cols.num) {
    const n = cols.num;
    qs.push({
      name: "num_stats",
      sql: `SELECT COUNT("${n}") AS c, MIN("${n}") AS mn, MAX("${n}") AS mx, SUM("${n}") AS s FROM dataset`,
    });
    qs.push({
      name: "num_hist",
      sql: `WITH b AS (SELECT MIN("${n}") mn, MAX("${n}") mx FROM dataset)
            SELECT CAST(50 * ("${n}" - mn) / NULLIF(mx - mn, 0) AS INTEGER) AS bin, COUNT(*) AS cnt
            FROM dataset, b GROUP BY 1 ORDER BY 1`,
    });
  }
  return qs;
}

/** Aggregate projection used by filter queries (count + distinct-category). */
function agg(cols: PickedCols): string {
  return cols.cat ? `COUNT(*) AS c, COUNT(DISTINCT "${cols.cat}") AS d` : "COUNT(*) AS c";
}

/**
 * Selection/cross-filter latency suite. Selectivity via `quantile_cont` so each
 * tier filters a true row-fraction (Abadi: latency flips with selectivity).
 * `filter_box` models a ~1% brush window mid-range.
 */
export function filterQueries(cols: PickedCols): NamedQuery[] {
  if (!cols.num) return [];
  const n = cols.num;
  const a = agg(cols);
  const tiers: [string, number][] = [
    ["0p1", 0.001],
    ["1", 0.01],
    ["10", 0.1],
    ["50", 0.5],
  ];
  const qs: NamedQuery[] = tiers.map(([label, p]) => ({
    name: `filter_sel_${label}`,
    sql: `SELECT ${a} FROM dataset WHERE "${n}" <= (SELECT quantile_cont("${n}", ${p}) FROM dataset)`,
  }));
  qs.push({
    name: "filter_box",
    sql: `WITH q AS (SELECT quantile_cont("${n}", 0.495) lo, quantile_cont("${n}", 0.505) hi FROM dataset)
          SELECT ${a} FROM dataset, q WHERE "${n}" BETWEEN q.lo AND q.hi`,
  });
  return qs;
}

/**
 * Cross-filter round-trip: the dependent aggregates (charts) re-run under one
 * ~1% selection predicate. Timed as a group → `crossfilter_suite_ms`, the
 * closest proxy to felt interactivity when a lasso/brush changes.
 */
export function crossfilterDependents(cols: PickedCols): NamedQuery[] {
  if (!cols.num) return [];
  const n = cols.num;
  const pred = `"${n}" <= (SELECT quantile_cont("${n}", 0.01) FROM dataset)`;
  const qs: NamedQuery[] = [{ name: "xf_count", sql: `SELECT COUNT(*) AS c FROM dataset WHERE ${pred}` }];
  if (cols.cat) {
    qs.push({
      name: "xf_cat_hist",
      sql: `SELECT "${cols.cat}" AS k, COUNT(*) AS nn FROM dataset WHERE ${pred} GROUP BY 1 ORDER BY nn DESC, k LIMIT 100`,
    });
  }
  qs.push({
    name: "xf_num_hist",
    sql: `WITH b AS (SELECT MIN("${n}") mn, MAX("${n}") mx FROM dataset WHERE ${pred})
          SELECT CAST(50 * ("${n}" - mn) / NULLIF(mx - mn, 0) AS INTEGER) AS bin, COUNT(*) AS cnt
          FROM dataset, b WHERE ${pred} GROUP BY 1 ORDER BY 1`,
  });
  return qs;
}
