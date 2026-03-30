/**
 * useMosaicQuery / useMosaicSelectionQuery
 *
 * TanStack Query wrappers around Mosaic's coordinator.query().
 *
 * Benefits over bare coordinator.query() in useEffect:
 * - Request deduplication across components (same SQL = single request)
 * - Automatic retry + error state
 * - Stale-time-based cache invalidation
 * - React DevTools visibility
 *
 * For Selection-reactive queries, use useMosaicSelectionQuery — it reads
 * the current brushPredicateStore.version as a cache-key dep so the query
 * automatically re-runs when the cross-filter predicate changes.
 */
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import type { Coordinator } from "@uwdata/mosaic-core";
import type { FilterExpr } from "@uwdata/mosaic-sql";
import { brushPredicateStore } from "../providers/BrushPredicateStore";
import { stringPredicate } from "../lib/mosaic-helpers";

// ── Static query (no Selection dependency) ──────────────────────────────────

export function useMosaicQuery<T>(
    coordinator: Coordinator,
    sql: string | null,
    transform: (result: unknown) => T,
    opts: { enabled?: boolean; staleTime?: number } = {},
) {
    return useQuery<T>({
        queryKey: ["mosaic", sql],
        queryFn: async () => {
            const result = await coordinator.query(sql!, { type: "json" });
            return transform(result);
        },
        enabled: !!sql && opts.enabled !== false,
        staleTime: opts.staleTime ?? 30_000,
    });
}

// ── Selection-reactive query (re-runs when brush predicate changes) ──────────

export function useMosaicSelectionQuery<T>(
    coordinator: Coordinator,
    buildSql: (predicate: FilterExpr | null) => string | null,
    transform: (result: unknown) => T,
    cacheKeyPrefix: string,
    opts: { enabled?: boolean; staleTime?: number } = {},
) {
    // brushPredicateStore.version drives cache invalidation — when isolation
    // or lasso selection changes, version increments and this query re-runs.
    const version = useStore(brushPredicateStore, (s) => s.version);
    const predicateStr = brushPredicateStore.state.predicate;

    // Build SQL using current predicate string wrapped as a FilterExpr-compatible
    // object so callers can call .toString() on it when building WHERE clauses.
    const sql = buildSql(predicateStr != null ? stringPredicate(predicateStr) : null);

    return useQuery<T>({
        queryKey: [cacheKeyPrefix, version, sql],
        queryFn: async () => {
            const result = await coordinator.query(sql!, { type: "json" });
            return transform(result);
        },
        enabled: !!sql && opts.enabled !== false,
        staleTime: opts.staleTime ?? 30_000,
    });
}
