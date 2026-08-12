/**
 * Mosaic↔TanStack bridge: server-side paginated data fetching from DuckDB.
 *
 * Manages a page cache with LRU eviction. DuckDB handles sorting and filtering;
 * the frontend only holds ~500 rows in memory at any time.
 */

import { useDebouncer } from "@tanstack/react-pacer";
import type { FilterCoordinationAPI, RowIndex } from "@ndea/sdk";
import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { count, type FilterExpr, Query } from "@uwdata/mosaic-sql";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMosaicClient } from "@/hooks/useMosaicClient";
import { filterExprToExpr, toRows } from "@/lib/mosaic-helpers";

const PAGE_SIZE = 100;
const MAX_CACHED_PAGES = 5;

export type Row = Record<string, unknown>;
export type SortDirection = "asc" | "desc";
export interface SortState {
  column: string;
  direction: SortDirection;
}

interface UseTableQueryBaseOptions {
  coordinator: Coordinator;
  table: string;
  columns: string[];
  sort?: SortState | null;
}
export type UseTableQueryOptions = UseTableQueryBaseOptions &
  ({ filter: FilterCoordinationAPI; selection?: never } | { filter?: never; selection: Selection });

export interface UseTableQueryResult {
  /** Total row count matching the current filter. */
  totalCount: number;
  /** Get a row by its virtual index. Returns undefined if not yet loaded. */
  getRow: (index: number) => Row | undefined;
  /** Return all currently cached rows (O(cached) not O(totalCount)). */
  getCachedRows: () => Row[];
  /** Request that a range of rows be loaded (call on scroll). */
  ensureRange: (startIndex: number, endIndex: number) => void;
  /** Whether the initial count query is loading. */
  loading: boolean;
  /** Find the position of a row by its __row_index__ value. */
  findRowPosition: (rowIndex: RowIndex) => Promise<number | null>;
}

export function tableFilterState(selection: Pick<Selection, "predicate">) {
  const predicate = selection.predicate(null);
  return {
    key: String(predicate),
    whereClause: predicate == null ? "" : `WHERE ${String(filterExprToExpr(predicate))}`,
  };
}

export function tableCacheKey(selection: Pick<Selection, "predicate">, revision: number, sort?: SortState | null) {
  const sortKey = sort ? `${sort.column}:${sort.direction}` : "none";
  return `${revision}:${String(selection.predicate(null))}|${sortKey}`;
}

function querySelection(options: UseTableQueryOptions): Selection {
  if (options.filter) return options.filter.selection;
  if (options.selection) return options.selection;
  throw new Error("useTableQuery requires a filter or selection");
}

export function useTableQuery(opts: UseTableQueryOptions): UseTableQueryResult {
  const { coordinator, table, columns, filter, sort } = opts;
  const selection = querySelection(opts);

  // ── Page cache ──────────────────────────────────────────────────
  const pagesRef = useRef(new Map());
  const pendingRef = useRef(new Set());
  const activeCacheKeyRef = useRef("");
  const [, forceUpdate] = useState(0);
  const [filterVersion, setFilterVersion] = useState(0);
  const [filterRevision, setFilterRevision] = useState(() => filter?.getResolved().revision ?? 0);
  useEffect(() => {
    if (!filter) return;
    return filter.subscribeResolved(({ revision }) => setFilterRevision(revision));
  }, [filter]);

  // ── Count query via Mosaic client (reactive to selection) ────────
  const countQuery = useCallback(
    (predicate: FilterExpr) => {
      const q = Query.from(table).select({ count: count() });
      const expr = filterExprToExpr(predicate);
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
    filter,
    selection,
    query: countQuery,
    transform: countTransform,
  });

  // ── Invalidate all pages when filter/sort changes ───────────────
  const cacheKey = tableCacheKey(selection, filterRevision, sort);
  const prevCacheKey = useRef(cacheKey);
  // Keep activeCacheKeyRef in sync on first render and when cacheKey changes.
  activeCacheKeyRef.current = cacheKey;

  // Debounce the re-fetch trigger so rapid lasso adjustments don't
  // cause a fetch on every intermediate update.
  const filterVersionDebouncer = useDebouncer(() => setFilterVersion((n) => n + 1), {
    wait: 150,
    leading: false,
    trailing: true,
    onUnmount: (d) => d.flush(),
  });

  useEffect(() => {
    if (prevCacheKey.current !== cacheKey) {
      // activeCacheKeyRef is already updated inline above.
      // Cancel in-flight fetches for the old key so they don't overwrite
      // fresh data when they land (fetchPage checks the key on completion).
      pendingRef.current.clear();
      prevCacheKey.current = cacheKey;
      filterVersionDebouncer.maybeExecute();
    }
  }, [cacheKey, filterVersionDebouncer.maybeExecute]); // eslint-disable-line react-hooks/exhaustive-deps

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

      // Snapshot the key at fetch time: discard result if it changes.
      const fetchedFor = activeCacheKeyRef.current;

      try {
        const offset = pageIndex * PAGE_SIZE;
        const colList = columns.map((c) => `"${c}"`).join(", ");
        const { whereClause } = tableFilterState(selection);
        const sql = `SELECT "__row_index__", ${colList} FROM ${table} ${whereClause} ORDER BY ${buildOrderBy()} LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

        const result = await coordinator.query(sql, { type: "arrow" });

        // Discard if the filter changed while we were waiting.
        if (fetchedFor !== activeCacheKeyRef.current) return;

        const rows = toRows(result);

        // LRU eviction: prefer evicting stale pages first.
        const pages = pagesRef.current;
        if (pages.size >= MAX_CACHED_PAGES) {
          let evictKey = -1;
          let evictTime = Infinity;
          for (const [key, entry] of pages) {
            const isStale = entry.cacheKey !== fetchedFor;
            const t = isStale ? -Infinity : entry.lastAccessed;
            if (t < evictTime) {
              evictTime = t;
              evictKey = key;
            }
          }
          if (evictKey >= 0) pages.delete(evictKey);
        }

        pages.set(pageIndex, { rows, lastAccessed: Date.now(), cacheKey: fetchedFor });
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
  // filterVersion is included so ensureRange gets a new reference whenever
  // the filter/sort settles: this causes the scroll useEffect in DataTable
  // to re-run and re-fetch the visible range without any extra dep wiring.
  const ensureRange = useCallback(
    (startIndex: number, endIndex: number) => {
      const startPage = Math.floor(startIndex / PAGE_SIZE);
      const endPage = Math.floor(endIndex / PAGE_SIZE);
      const activeKey = activeCacheKeyRef.current;
      // Fetch visible pages + one page ahead/behind.
      // Treat stale pages (wrong cacheKey) as missing so they get refreshed.
      for (let p = Math.max(0, startPage - 1); p <= endPage + 1; p++) {
        const entry = pagesRef.current.get(p);
        const needsFetch = !entry || entry.cacheKey !== activeKey;
        if (needsFetch && !pendingRef.current.has(p)) {
          void fetchPage(p);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchPage, filterVersion],
  );

  // ── Public: find row position for scroll-to-highlight ───────────
  const findRowPosition = useCallback(
    async (rowIndex: RowIndex): Promise<number | null> => {
      const { whereClause } = tableFilterState(selection);

      try {
        // Count rows that come before this one in sort order
        const countSql = `
                    WITH target AS (SELECT * FROM ${table} WHERE __row_index__ = ${rowIndex})
                    SELECT COUNT(*) AS pos FROM ${table}
                    ${whereClause || "WHERE TRUE"}
                    AND (${sort ? `("${sort.column}" < (SELECT "${sort.column}" FROM target) OR ("${sort.column}" = (SELECT "${sort.column}" FROM target) AND __row_index__ <= ${rowIndex}))` : `__row_index__ <= ${rowIndex}`})
                `;
        const result = await coordinator.query(countSql, { type: "arrow" });
        const rows = toRows<{ pos: number }>(result);
        const pos = rows[0]?.pos;
        return pos != null ? pos - 1 : null; // -1 because we count rows <= target
      } catch {
        return null;
      }
    },
    [coordinator, table, selection, sort],
  );

  const getCachedRows = useCallback((): Row[] => {
    const rows: Row[] = [];
    for (const entry of pagesRef.current.values()) {
      for (const row of entry.rows) rows.push(row);
    }
    return rows;
  }, []);

  return {
    totalCount: totalCount ?? 0,
    getRow,
    getCachedRows,
    ensureRange,
    loading,
    findRowPosition,
  };
}
