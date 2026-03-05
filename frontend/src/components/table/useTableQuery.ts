/**
 * Mosaic↔TanStack bridge: server-side paginated data fetching from DuckDB.
 *
 * Manages a page cache with LRU eviction. DuckDB handles sorting and filtering;
 * the frontend only holds ~500 rows in memory at any time.
 */

import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { count, type FilterExpr, Query } from "@uwdata/mosaic-sql";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMosaicClient } from "../../hooks/useMosaicClient";
import { filterExprToExpr, toRows } from "../../lib/mosaic-helpers";

const PAGE_SIZE = 100;
const MAX_CACHED_PAGES = 5;

export type Row = Record<string, unknown>;
export type SortDirection = "asc" | "desc";
export interface SortState {
    column: string;
    direction: SortDirection;
}

interface PageEntry {
    rows: Row[];
    lastAccessed: number;
}

export interface UseTableQueryOptions {
    coordinator: Coordinator;
    table: string;
    columns: string[];
    selection?: Selection;
    sort?: SortState | null;
}

export interface UseTableQueryResult {
    /** Total row count matching the current filter. */
    totalCount: number;
    /** Get a row by its virtual index. Returns undefined if not yet loaded. */
    getRow: (index: number) => Row | undefined;
    /** Request that a range of rows be loaded (call on scroll). */
    ensureRange: (startIndex: number, endIndex: number) => void;
    /** Whether the initial count query is loading. */
    loading: boolean;
    /** Find the position of a row by its __row_index__ value. */
    findRowPosition: (rowIndex: string | number) => Promise<number | null>;
}

export function useTableQuery(opts: UseTableQueryOptions): UseTableQueryResult {
    const { coordinator, table, columns, selection, sort } = opts;

    // ── Page cache ──────────────────────────────────────────────────
    const pagesRef = useRef<Map<number, PageEntry>>(new Map());
    const pendingRef = useRef<Set<number>>(new Set());
    const [, forceUpdate] = useState(0);

    // ── Count query via Mosaic client (reactive to selection) ────────
    const countQuery = useCallback(
        (predicate: unknown) => {
            const q = Query.from(table).select({ count: count() });
            const expr = filterExprToExpr(predicate as FilterExpr);
            if (expr) q.where(expr);
            return q;
        },
        [table],
    );

    const countTransform = useCallback((result: unknown) => {
        const rows = toRows<{ count: number }>(result);
        return rows[0]?.count ?? 0;
    }, []);

    const { data: totalCount, loading } = useMosaicClient<number>({
        coordinator,
        selection,
        query: countQuery,
        transform: countTransform,
    });

    // ── Invalidate all pages when filter/sort changes ───────────────
    const filterKey = selection ? String(selection.predicate(null)) : "none";
    const sortKey = sort ? `${sort.column}:${sort.direction}` : "none";
    const cacheKey = `${filterKey}|${sortKey}`;
    const prevCacheKey = useRef(cacheKey);

    useEffect(() => {
        if (prevCacheKey.current !== cacheKey) {
            pagesRef.current.clear();
            pendingRef.current.clear();
            prevCacheKey.current = cacheKey;
            forceUpdate((n) => n + 1);
        }
    }, [cacheKey]);

    // ── Build ORDER BY clause ───────────────────────────────────────
    const buildOrderBy = useCallback(() => {
        if (!sort) return "__row_index__ ASC";
        const dir = sort.direction === "desc" ? "DESC" : "ASC";
        return `"${sort.column}" ${dir}, __row_index__ ASC`;
    }, [sort]);

    // ── Fetch a page from DuckDB ────────────────────────────────────
    const fetchPage = useCallback(
        async (pageIndex: number) => {
            if (pendingRef.current.has(pageIndex)) return;
            pendingRef.current.add(pageIndex);

            try {
                const offset = pageIndex * PAGE_SIZE;
                const colList = columns.map((c) => `"${c}"`).join(", ");
                const filterExpr = selection?.predicate(null);
                const whereClause = filterExpr ? `WHERE ${filterExprToExpr(filterExpr as FilterExpr)}` : "";
                const sql = `SELECT "__row_index__", ${colList} FROM ${table} ${whereClause} ORDER BY ${buildOrderBy()} LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

                const result = await coordinator.query(sql, { type: "json" });
                const rows = toRows<Row>(result);

                // LRU eviction
                const pages = pagesRef.current;
                if (pages.size >= MAX_CACHED_PAGES) {
                    let oldestKey = -1;
                    let oldestTime = Infinity;
                    for (const [key, entry] of pages) {
                        if (entry.lastAccessed < oldestTime) {
                            oldestTime = entry.lastAccessed;
                            oldestKey = key;
                        }
                    }
                    if (oldestKey >= 0) pages.delete(oldestKey);
                }

                pages.set(pageIndex, { rows, lastAccessed: Date.now() });
                forceUpdate((n) => n + 1);
            } finally {
                pendingRef.current.delete(pageIndex);
            }
        },
        [coordinator, table, columns, selection, buildOrderBy],
    );

    // ── Public: get a row by virtual index ──────────────────────────
    const getRow = useCallback((index: number): Row | undefined => {
        const pageIndex = Math.floor(index / PAGE_SIZE);
        const entry = pagesRef.current.get(pageIndex);
        if (!entry) return undefined;
        entry.lastAccessed = Date.now();
        return entry.rows[index - pageIndex * PAGE_SIZE];
    }, []);

    // ── Public: ensure a range is loaded (call from scroll handler) ─
    const ensureRange = useCallback(
        (startIndex: number, endIndex: number) => {
            const startPage = Math.floor(startIndex / PAGE_SIZE);
            const endPage = Math.floor(endIndex / PAGE_SIZE);
            // Fetch visible pages + one page ahead/behind
            for (let p = Math.max(0, startPage - 1); p <= endPage + 1; p++) {
                if (!pagesRef.current.has(p) && !pendingRef.current.has(p)) {
                    fetchPage(p);
                }
            }
        },
        [fetchPage],
    );

    // ── Public: find row position for scroll-to-highlight ───────────
    const findRowPosition = useCallback(
        async (rowIndex: string | number): Promise<number | null> => {
            const filterExpr = selection?.predicate(null);

            try {
                // Count rows that come before this one in sort order
                const countSql = `
                    WITH target AS (SELECT * FROM ${table} WHERE __row_index__ = ${Number(rowIndex)})
                    SELECT COUNT(*) AS pos FROM ${table}
                    WHERE ${filterExpr ? filterExprToExpr(filterExpr as FilterExpr) : "TRUE"}
                    AND (${sort ? `("${sort.column}" < (SELECT "${sort.column}" FROM target) OR ("${sort.column}" = (SELECT "${sort.column}" FROM target) AND __row_index__ <= ${Number(rowIndex)}))` : `__row_index__ <= ${Number(rowIndex)}`})
                `;
                const result = await coordinator.query(countSql, { type: "json" });
                const rows = toRows<{ pos: number }>(result);
                const pos = rows[0]?.pos;
                return pos != null ? pos - 1 : null; // -1 because we count rows <= target
            } catch {
                return null;
            }
        },
        [coordinator, table, selection, sort],
    );

    return {
        totalCount: totalCount ?? 0,
        getRow,
        ensureRange,
        loading,
        findRowPosition,
    };
}
