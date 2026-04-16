/**
 * Create an integer category index column in DuckDB for coloring the scatter plot.
 *
 * Mirrors the pattern from embedding-atlas's `category_column.ts`:
 * 1. Query top-N distinct values by count
 * 2. ALTER TABLE obs_base ADD COLUMN __ev_{col}_id INTEGER
 * 3. UPDATE obs_base SET __ev_{col}_id = CASE WHEN col='A' THEN 0 ...
 * 4. The `dataset` VIEW automatically picks up the new column.
 */

import type { Coordinator } from "@uwdata/mosaic-core";
import { rebuildDatasetView, toRows } from "./mosaic-helpers";

export interface CategoryLegendItem {
  label: string;
  color: string;
  index: number;
  count: number;
}

export interface CategoryMapping {
  indexColumn: string;
  legend: CategoryLegendItem[];
}

export const OTHER_COLOR = "#6b7280";
export const NULL_COLOR = "#4b5563";

const DEFAULT_MAX_CATEGORIES = 64;

/**
 * Cache of already-created columns so we don't re-run ALTER TABLE.
 * WeakMap keyed on coordinator instance — automatically cleared when
 * the coordinator is garbage-collected (e.g. on HMR or server restart).
 */
const createdColumnsCache = new WeakMap<Coordinator, Set<string>>();

function getCreatedColumns(coordinator: Coordinator): Set<string> {
  let set = createdColumnsCache.get(coordinator);
  if (!set) {
    set = new Set();
    createdColumnsCache.set(coordinator, set);
  }
  return set;
}

export async function makeCategoryColumn(
  coordinator: Coordinator,
  column: string,
  maxCategories: number = DEFAULT_MAX_CATEGORIES,
): Promise<CategoryMapping> {
  const indexCol = `__ev_${column}_id`;
  const createdColumns = getCreatedColumns(coordinator);

  // Query top categories by count
  const result = await coordinator.query(
    `SELECT CAST("${column}" AS TEXT) AS value, COUNT(*) AS count
         FROM obs_base
         WHERE CAST("${column}" AS TEXT) IS NOT NULL
         GROUP BY CAST("${column}" AS TEXT)
         ORDER BY count DESC
         LIMIT ${maxCategories}`,
    { type: "json" },
  );
  const values = toRows<{ value: string; count: number }>(result);

  const otherIndex = values.length;
  const nullIndex = values.length + 1;

  // Build the CASE WHEN expression
  const whenClauses = values.map(({ value }, i) => `WHEN '${value.replace(/'/g, "''")}' THEN ${i}`).join(" ");

  // Add column + update (idempotent via IF NOT EXISTS)
  // Then rebuild the `dataset` VIEW so DuckDB's cached schema picks up the new column.
  if (!createdColumns.has(indexCol)) {
    await coordinator.exec(`ALTER TABLE obs_base ADD COLUMN IF NOT EXISTS "${indexCol}" INTEGER DEFAULT 0`);
    createdColumns.add(indexCol);
  }

  await coordinator.exec(
    `UPDATE obs_base SET "${indexCol}" = CASE CAST("${column}" AS TEXT)
            ${whenClauses}
            ELSE (CASE WHEN "${column}" IS NULL THEN ${nullIndex} ELSE ${otherIndex} END)
         END`,
  );

  await rebuildDatasetView(coordinator);

  // Build legend — colors are intentionally empty here; the component applies
  // the palette via a useMemo so that re-coloring never re-runs this DB work.
  const legend: CategoryLegendItem[] = values.map(({ value, count }, i) => ({
    label: value,
    color: "",
    index: i,
    count,
  }));

  // Query other/null counts
  const countResult = await coordinator.query(
    `SELECT "${indexCol}" AS idx, COUNT(*)::INT AS cnt
         FROM obs_base GROUP BY "${indexCol}"`,
    { type: "json" },
  );
  const counts = toRows<{ idx: number; cnt: number }>(countResult);

  const countMap = new Map(counts.map((r) => [r.idx, r.cnt]));

  const otherCount = countMap.get(otherIndex) ?? 0;
  if (otherCount > 0) {
    legend.push({
      label: `(other)`,
      color: OTHER_COLOR,
      index: otherIndex,
      count: otherCount,
    });
  }

  const nullCount = countMap.get(nullIndex) ?? 0;
  if (nullCount > 0) {
    legend.push({
      label: "(null)",
      color: NULL_COLOR,
      index: nullIndex,
      count: nullCount,
    });
  }

  return { indexColumn: indexCol, legend };
}
