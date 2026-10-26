/**
 * A categorical column's index column and legend (`/api/categorize`), as one
 * React Query entry: the scatter and the gallery's color strip share it, so
 * a column is categorized once and both color its categories alike.
 */

import type { Coordinator } from "@uwdata/mosaic-core";
import { quoteIdent } from "@ndea/protocol";
import type { CategoryMapping } from "../scatter/contracts";
import { toRows } from "./mosaic";

export type Categorize = (column: string, maxCategories: number) => Promise<CategoryMapping>;

/** Query options for `column`'s mapping: `n` categories (at most 256), each with a palette index. */
export function categoryMappingQuery(coordinator: Coordinator, column: string | null, categorize: Categorize) {
  return {
    queryKey: ["category-mapping", column, "categorical"] as const,
    enabled: !!column,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async () => {
      const col = column as string;
      const countResult = await coordinator.query(
        `SELECT COUNT(DISTINCT CAST(${quoteIdent(col)} AS TEXT))::INT AS n FROM obs_base`,
      );
      const n = Math.min(toRows<{ n: number }>(countResult)[0]?.n ?? 64, 256);
      return { n, mapping: await categorize(col, n) };
    },
  };
}
