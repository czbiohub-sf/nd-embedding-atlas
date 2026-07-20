/**
 * Client stub for categorical-index materialization.
 *
 * The heavy lift (ALTER TABLE / UPDATE / VIEW rebuild + legend computation)
 * lives server-side at `POST /api/categorize`. This module owns the client
 * contract + palette colors; nothing else.
 *
 * Previously this file called `coordinator.exec(ALTER ...)` + `coordinator.exec(UPDATE ...)`.
 * Those mutations raced with the server's `_rebuildView()` and forced the Mosaic
 * SQL allow-list to accept ALTER/UPDATE traffic through `/data/query`. Moving
 * them server-side removes both problems.
 */

import type { Coordinator } from "@uwdata/mosaic-core";
import type { CategorizeResponse } from "@ndea/protocol";

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

export async function makeCategoryColumn(
  coordinator: Coordinator,
  column: string,
  maxCategories: number = DEFAULT_MAX_CATEGORIES,
): Promise<CategoryMapping> {
  // `coordinator` retained in the signature for API stability: the server
  // owns DuckDB state now, but existing call sites pass it through.
  void coordinator;

  const res = await fetch("/api/categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ column, maxCategories }),
  });
  if (!res.ok) {
    throw new Error(`categorize failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as CategorizeResponse;

  const legend: CategoryLegendItem[] = body.legend.map((item) => {
    // Colors applied by the UI layer (useMemo picks a palette). For the
    // reserved (other) / (null) buckets, the color is fixed.
    let color = "";
    if (item.index === body.otherIndex) color = OTHER_COLOR;
    if (item.index === body.nullIndex) color = NULL_COLOR;
    return { label: item.label, color, index: item.index, count: item.count };
  });

  return { indexColumn: body.indexColumn, legend };
}
