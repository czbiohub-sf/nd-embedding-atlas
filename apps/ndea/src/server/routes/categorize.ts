/**
 * Categorical index column materialization (server-side), so the browser
 * never sends `ALTER`/`UPDATE` through Mosaic's `/data/query`.
 *
 * POST /api/categorize  body: { column, maxCategories? }
 *   1. Resolve `column` against the VIEW's column catalog (400 if unknown).
 *   2. Query top-N distinct values by count (CAST to TEXT for uniformity).
 *   3. Add obs_base.__ev_{col}_id INTEGER (the store rebuilds the VIEW).
 *   4. UPDATE obs_base SET __ev_{col}_id = CASE ... for each value.
 *   5. Return { indexColumn, legend, otherIndex, nullIndex }.
 */

import { CategorizeBodySchema, parseJsonBody } from "../protocol.ts";
import type { CategorizeResponse, CategoryLegendItem } from "../protocol.ts";
import { quoteIdent } from "@ndea/protocol";
import type { DatasetQuerySession } from "../store.ts";

const DEFAULT_MAX_CATEGORIES = 64;

export async function handleCategorize(req: Request, store: DatasetQuerySession): Promise<Response> {
  const parsed = await parseJsonBody(req, CategorizeBodySchema);
  if (!parsed.ok) return parsed.response;
  const { column, maxCategories = DEFAULT_MAX_CATEGORIES } = parsed.data;
  if (!store.columns().has(column)) return Response.json({ error: `Unknown column "${column}"` }, { status: 400 });

  const source = quoteIdent(column);
  const indexColumn = `__ev_${column}_id`;
  const index = quoteIdent(indexColumn);

  try {
    // Source column reads go through the `dataset` VIEW, not `obs_base`, so
    // obs, var, and user-annotation columns categorize uniformly.
    const topRows = await store.querySingleJson(
      `SELECT CAST(${source} AS TEXT) AS value, COUNT(*) AS count
             FROM dataset
             WHERE CAST(${source} AS TEXT) IS NOT NULL
             GROUP BY CAST(${source} AS TEXT)
             ORDER BY count DESC
             LIMIT ${maxCategories}`,
    );
    const values = topRows as { value: string; count: number | bigint }[];

    const otherIndex = values.length;
    const nullIndex = values.length + 1;

    // The VIEW is rebuilt BEFORE the UPDATE, which reads the source value
    // through it (the source may live in an ann_/var_ join, not on obs_base).
    await store.addObsIndexColumn(indexColumn);

    // CASE maps the top-N values to indices; everything else falls to (other)/(null).
    const whenClauses = values.map(({ value }, i) => `WHEN '${value.replace(/'/g, "''")}' THEN ${i}`).join(" ");
    await store.executeSingle(
      `UPDATE obs_base SET ${index} = CASE CAST(d.${source} AS TEXT)
               ${whenClauses}
               ELSE (CASE WHEN d.${source} IS NULL THEN ${nullIndex} ELSE ${otherIndex} END)
             END
             FROM dataset d WHERE d.__row_index__ = obs_base.__row_index__`,
    );

    // Counts per bucket (including other/null if present).
    const countRows = await store.querySingleJson(
      `SELECT ${index} AS idx, COUNT(*)::BIGINT AS cnt FROM obs_base GROUP BY ${index}`,
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
