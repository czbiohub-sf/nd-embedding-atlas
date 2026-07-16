/**
 * Categorical index column materialization (server-side).
 *
 * Replaces frontend `category-column.ts` `coordinator.exec(ALTER/UPDATE)` path.
 * Doing this on the server means:
 *   - No client-side SQL mutations racing with `_rebuildView()`.
 *   - The Mosaic query filter can drop the `ALTER TABLE obs_base ADD COLUMN`
 *     + `UPDATE obs_base SET` allow-list entries.
 *   - Column creation state is scoped to the store, not a frontend WeakMap.
 *
 * POST /api/categorize  body: { column, maxCategories? }
 *   1. Query top-N distinct values by count (CAST to TEXT for uniformity).
 *   2. ALTER TABLE obs_base ADD COLUMN IF NOT EXISTS __ev_{col}_id INTEGER.
 *   3. UPDATE obs_base SET __ev_{col}_id = CASE ... for each value.
 *   4. Rebuild `dataset` VIEW so clients see the new column.
 *   5. Return { indexColumn, legend, otherIndex, nullIndex }.
 */

import { CategorizeBodySchema, parseJsonBody } from "../protocol.ts";
import type { ServerSession } from "../state.ts";
import type { CategorizeResponse, CategoryLegendItem } from "../protocol.ts";

const DEFAULT_MAX_CATEGORIES = 64;

export async function handleCategorize(req: Request, state: ServerSession): Promise<Response> {
  const parsed = await parseJsonBody(req, CategorizeBodySchema);
  if (!parsed.ok) return parsed.response;
  const { column, maxCategories = DEFAULT_MAX_CATEGORIES } = parsed.data;

  const { store } = state;
  const indexColumn = `__ev_${column}_id`;

  try {
    // Source column reads go through the `dataset` VIEW, not `obs_base`:
    // `dataset` is the logical obs table (obs_base columns + var/annotation
    // joins), so this categorizes obs, var, AND user-annotation columns
    // uniformly. obs_base is just the physical base.

    // 1. Top-N values by count.
    const topRows = await store.queryJson(
      `SELECT CAST("${column}" AS TEXT) AS value, COUNT(*) AS count
             FROM dataset
             WHERE CAST("${column}" AS TEXT) IS NOT NULL
             GROUP BY CAST("${column}" AS TEXT)
             ORDER BY count DESC
             LIMIT ${maxCategories}`,
    );
    const values = topRows as { value: string; count: number | bigint }[];

    const otherIndex = values.length;
    const nullIndex = values.length + 1;

    // 2. Materialise the index column on obs_base, then rebuild the VIEW
    // BEFORE the UPDATE: `ALTER TABLE obs_base ADD COLUMN` invalidates the
    // `dataset` VIEW schema, and step 3 reads the source value through that
    // VIEW (the source may live in an ann_/var_ join, not on obs_base).
    await store.execute(`ALTER TABLE obs_base ADD COLUMN IF NOT EXISTS "${indexColumn}" INTEGER DEFAULT 0`);
    await store._rebuildView();

    // 3. Populate via a JOIN back to `dataset` — d."${column}" resolves whether
    // the source is an obs_base column or an annotation/var join. CASE maps the
    // top-N values to indices; everything else falls to (other)/(null).
    const whenClauses = values.map(({ value }, i) => `WHEN '${value.replace(/'/g, "''")}' THEN ${i}`).join(" ");
    await store.execute(
      `UPDATE obs_base SET "${indexColumn}" = CASE CAST(d."${column}" AS TEXT)
               ${whenClauses}
               ELSE (CASE WHEN d."${column}" IS NULL THEN ${nullIndex} ELSE ${otherIndex} END)
             END
             FROM dataset d WHERE d.__row_index__ = obs_base.__row_index__`,
    );

    // Keep state.obsColumns in sync — endpoints that validate `category_col`
    // (e.g. /api/trajectory) read this list and would otherwise reject the
    // freshly created column with 400 "Unknown category_col".
    if (!state.obsColumns.includes(indexColumn)) {
      state.obsColumns.push(indexColumn);
    }

    // 5. Counts per bucket (including other/null if present).
    const countRows = await store.queryJson(
      `SELECT "${indexColumn}" AS idx, COUNT(*)::BIGINT AS cnt FROM obs_base GROUP BY "${indexColumn}"`,
    );
    const counts = countRows as { idx: number | bigint; cnt: number | bigint }[];
    const countMap = new Map<number, number>();
    for (const r of counts) countMap.set(Number(r.idx), Number(r.cnt));

    const legend: CategoryLegendItem[] = values.map(({ value, count }, i) => ({
      label: value,
      index: i,
      count: Number(count),
    }));

    const otherCount = countMap.get(otherIndex) ?? 0;
    if (otherCount > 0) {
      legend.push({ label: "(other)", index: otherIndex, count: otherCount });
    }
    const nullCount = countMap.get(nullIndex) ?? 0;
    if (nullCount > 0) {
      legend.push({ label: "(null)", index: nullIndex, count: nullCount });
    }

    const body: CategorizeResponse = { indexColumn, legend, otherIndex, nullIndex };
    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
