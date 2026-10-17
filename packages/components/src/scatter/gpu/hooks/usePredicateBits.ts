import type { FilterCoordinationAPI } from "@ndea/sdk";
import type { Coordinator } from "@uwdata/mosaic-core";
import { type FilterExpr, literal, Query, sql } from "@uwdata/mosaic-sql";
import { useCallback, useState } from "react";
import { filterExprToExpr } from "../../helpers";
import { useMosaicClient } from "../../../query/useMosaicClient";

export function hasFilterPredicate(predicate: FilterExpr | null | undefined): boolean {
  if (predicate == null) return false;
  if (Array.isArray(predicate)) return predicate.some(hasFilterPredicate);
  if (typeof predicate === "boolean") return !predicate;
  const text = predicate.toString().trim().toLowerCase();
  return text !== "" && text !== "null" && text !== "true";
}

/** One row per non-empty 32-row word: `w` = row >> 5, `bits` = OR of 1 << (row & 31). */
export function predicateBitsQuery(table: string, predicate: FilterExpr) {
  return Query.from(table)
    .select({
      w: sql`(__row_index__ // 32)::UINTEGER`,
      bits: sql`bit_or(1::UBIGINT << (__row_index__ % 32)::INTEGER)::UINTEGER`,
    })
    .where(hasFilterPredicate(predicate) ? filterExprToExpr(predicate) : literal(false))
    .groupby("w");
}

/** Scatter `(w, bits)` rows into a bit layer; words past the last match stay absent (= 0). */
export function scatterWords(w: ArrayLike<number>, bits: ArrayLike<number>): Uint32Array {
  let length = 0;
  for (let i = 0; i < w.length; i++) length = Math.max(length, w[i] + 1);
  const words = new Uint32Array(length);
  for (let i = 0; i < w.length; i++) words[w[i]] = bits[i]!;
  return words;
}

type ArrowTable = { getChild(name: string): { toArray(): ArrayLike<number> } | null };

/**
 * Resolve the combined filter selection to a row bitmask (bit `r & 31` of
 * word `r >> 5`) without rebuilding the scatter's position and color buffers.
 * Row index = point index. `bits` is null while no predicate is active.
 * Mosaic caches by SQL; `inSet` predicates name immutable content-addressed
 * sets, so the cached words never go stale.
 */
export function usePredicateBits(options: { coordinator: Coordinator; filter: FilterCoordinationAPI; table: string }): {
  bits: Uint32Array | null;
  error: Error | null;
} {
  const { coordinator, filter, table } = options;
  const [active, setActive] = useState(false);

  const query = useCallback(
    (predicate: FilterExpr) => {
      setActive(hasFilterPredicate(predicate));
      return predicateBitsQuery(table, predicate);
    },
    [table],
  );
  const transform = useCallback((result: unknown) => {
    const t = result as ArrowTable;
    return scatterWords(t.getChild("w")?.toArray() ?? [], t.getChild("bits")?.toArray() ?? []);
  }, []);
  const { data, error } = useMosaicClient<Uint32Array>({
    coordinator,
    filter,
    filterStable: false,
    query,
    transform,
  });

  return { bits: active ? data : null, error };
}
