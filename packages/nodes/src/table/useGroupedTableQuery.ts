/**
 * Server-side grouped rows for the table node.
 *
 * The grouping itself is a DuckDB `GROUP BY`, not TanStack Table's client-side
 * grouped row model: the browser only ever holds a few pages of the dataset, so a
 * client-side model would group one page and label it as groups over everything.
 * TanStack Table is left to render the result via `manualGrouping`/`manualExpanding`.
 *
 * Two queries, deliberately asymmetric:
 *
 *  - GROUP SUMMARIES are fetched whole (bounded by `MAX_GROUPS`) as one
 *    `GROUP BY` with `COUNT(*)`. Having every key and count up front is what lets
 *    `grouped-rows` compute an exact virtual row count synchronously, so the
 *    scrollbar is correct before a single child has loaded.
 *  - CHILDREN are paged per group and fetched only for the visible range, so
 *    expanding a 100k-row group costs one page.
 *
 * The filter/sort invalidation, LRU page cache and cache-key guards mirror
 * `useTableQuery`; a divergence between the two would show up as stale rows.
 */

import { useDebouncer } from "@tanstack/react-pacer";
import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { predicateToSql, toRows } from "../query/mosaic";
import {
  childRangesFor,
  type GroupedLayout,
  type GroupKey,
  type GroupSummary,
  headerIndexOf,
  layoutGroups,
  slotAt,
} from "./grouped-rows";
import type { Row, SortState } from "./useTableQuery";

/** Children fetched per request within a group. */
const CHILD_PAGE_SIZE = 100;
/** Child pages retained across all groups before eviction. */
const MAX_CACHED_PAGES = 8;
/**
 * Upper bound on distinct groups. A `GROUP BY` over a high-cardinality column
 * (say `obs_name`) would otherwise try to render one header per row; capping keeps
 * a mis-chosen grouping column from hanging the node, and the caller surfaces the
 * truncation rather than pretending the list is complete.
 */
const MAX_GROUPS = 5000;

/** Double-quote a SQL identifier, doubling any embedded quote. */
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** A scalar group key as a SQL literal, escaping quotes in the string case. */
function literalOf(value: GroupKey): string {
  return typeof value === "number" ? String(value) : `'${value.replace(/'/g, "''")}'`;
}

/** What the renderer gets for one virtual row. */
export type ResolvedSlot =
  | { kind: "header"; group: GroupSummary; groupIndex: number }
  /** `row` is undefined while its page is in flight; render a skeleton. */
  | { kind: "child"; group: GroupSummary; groupIndex: number; childOffset: number; row: Row | undefined };

export interface UseGroupedTableQueryOptions {
  coordinator: Coordinator;
  table: string;
  columns: string[];
  /** Column to group by. Null disables the hook entirely. */
  groupBy: string | null;
  /** Keys whose children are shown. */
  expanded: ReadonlySet<GroupKey>;
  selection: Selection;
  sort?: SortState | null;
}

export interface UseGroupedTableQueryResult {
  layout: GroupedLayout;
  /** Flat virtual row count: headers plus children of expanded groups. */
  totalCount: number;
  getSlot: (index: number) => ResolvedSlot | undefined;
  ensureRange: (startIndex: number, endIndex: number) => void;
  headerIndexOfGroup: (key: GroupKey) => number | undefined;
  loading: boolean;
  /** True when the group list hit `MAX_GROUPS` and is not the whole story. */
  truncated: boolean;
}

const EMPTY_LAYOUT: GroupedLayout = { groups: [], headerAt: [], totalCount: 0 };

interface ChildPage {
  rows: Row[];
  cacheKey: string;
}

export function useGroupedTableQuery({
  coordinator,
  table,
  columns,
  groupBy,
  expanded,
  selection,
  sort,
}: UseGroupedTableQueryOptions): UseGroupedTableQueryResult {
  const [groups, setGroups] = useState<readonly GroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [, forceUpdate] = useState(0);

  const pagesRef = useRef<Map<string, ChildPage>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const activeCacheKeyRef = useRef("");

  // Predicate text, not the Selection object: the Selection mutates in place, so
  // its identity is useless as a change signal.
  const predicate = predicateToSql(selection);
  const sortKey = sort ? `${sort.column}:${sort.direction}` : "none";
  const cacheKey = `${groupBy ?? "-"}|${predicate ?? "-"}|${sortKey}`;
  activeCacheKeyRef.current = cacheKey;

  const orderBy = sort
    ? `${ident(sort.column)} ${sort.direction === "desc" ? "DESC" : "ASC"}, ${ident("__row_index__")} ASC`
    : `${ident("__row_index__")} ASC`;

  // ── Group summaries ──────────────────────────────────────────────
  // Debounced because a lasso drag republishes its predicate continuously and each
  // change would otherwise re-run a full GROUP BY.
  const [groupVersion, setGroupVersion] = useState(0);
  const bumpGroups = useDebouncer(() => setGroupVersion((n) => n + 1), {
    wait: 150,
    leading: false,
    trailing: true,
    onUnmount: (d) => d.flush(),
  });
  const prevCacheKey = useRef(cacheKey);
  useEffect(() => {
    if (prevCacheKey.current === cacheKey) return;
    prevCacheKey.current = cacheKey;
    // Drop child pages and cancel in-flight fetches keyed to the old filter.
    pagesRef.current.clear();
    pendingRef.current.clear();
    bumpGroups.maybeExecute();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debouncer identity is stable
  }, [cacheKey, bumpGroups.maybeExecute]);

  useEffect(() => {
    if (groupBy == null) {
      setGroups([]);
      setTruncated(false);
      return;
    }
    let alive = true;
    setGroupsLoading(true);
    const where = predicate ? ` WHERE ${predicate}` : "";
    const sql =
      `SELECT ${ident(groupBy)} AS key, COUNT(*)::INT AS n FROM ${table}${where} ` +
      `GROUP BY 1 ORDER BY 1 ASC LIMIT ${MAX_GROUPS + 1}`;
    void coordinator
      .query(sql, { type: "json" })
      .then((result: unknown) => {
        if (!alive) return;
        const rows = toRows<{ key: GroupKey | null; n: number }>(result);
        const over = rows.length > MAX_GROUPS;
        setTruncated(over);
        setGroups(
          rows
            .slice(0, MAX_GROUPS)
            // A NULL group key is a real bucket in SQL but cannot be addressed by
            // an equality predicate, so it is dropped rather than rendered as an
            // un-expandable header.
            .filter((r): r is { key: GroupKey; n: number } => r.key != null)
            .map((r) => ({ key: r.key, count: r.n })),
        );
      })
      .catch(() => {
        if (alive) setGroups([]);
      })
      .finally(() => {
        if (alive) setGroupsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [coordinator, table, groupBy, predicate, groupVersion]);

  // ── Flattened layout ─────────────────────────────────────────────
  const layout = groupBy == null ? EMPTY_LAYOUT : layoutGroups(groups, (key) => expanded.has(key));

  // ── Child pages ──────────────────────────────────────────────────
  const fetchChildPage = useCallback(
    async (group: GroupSummary, pageIndex: number) => {
      if (groupBy == null) return;
      const key = `${cacheKey}#${String(group.key)}#${pageIndex}`;
      if (pendingRef.current.has(key) || pagesRef.current.has(key)) return;
      pendingRef.current.add(key);
      const fetchedFor = activeCacheKeyRef.current;
      try {
        const colList = columns.map((c) => ident(c)).join(", ");
        const scope = predicate ? ` AND (${predicate})` : "";
        const sql =
          `SELECT ${ident("__row_index__")}${colList ? `, ${colList}` : ""} FROM ${table} ` +
          `WHERE ${ident(groupBy)} = ${literalOf(group.key)}${scope} ` +
          `ORDER BY ${orderBy} LIMIT ${CHILD_PAGE_SIZE} OFFSET ${pageIndex * CHILD_PAGE_SIZE}`;
        const result = await coordinator.query(sql, { type: "json" });
        // Discard if the filter moved while this was in flight.
        if (fetchedFor !== activeCacheKeyRef.current) return;

        const pages = pagesRef.current;
        if (pages.size >= MAX_CACHED_PAGES) {
          // Evict stale keys first, then anything.
          const stale = [...pages.entries()].find(([, page]) => page.cacheKey !== fetchedFor);
          pages.delete(stale ? stale[0] : (pages.keys().next().value as string));
        }
        pages.set(key, { rows: toRows<Row>(result), cacheKey: fetchedFor });
        forceUpdate((n) => n + 1);
      } catch {
        // Leave the slot undefined; the row renders as a skeleton and a later
        // ensureRange retries.
      } finally {
        pendingRef.current.delete(key);
      }
    },
    [coordinator, table, columns, groupBy, predicate, orderBy, cacheKey],
  );

  const ensureRange = useCallback(
    (startIndex: number, endIndex: number) => {
      if (groupBy == null) return;
      for (const range of childRangesFor(layout, startIndex, endIndex)) {
        const firstPage = Math.floor(range.from / CHILD_PAGE_SIZE);
        const lastPage = Math.floor(range.to / CHILD_PAGE_SIZE);
        for (let page = firstPage; page <= lastPage; page++) void fetchChildPage(range.group, page);
      }
    },
    [layout, fetchChildPage, groupBy],
  );

  const getSlot = useCallback(
    (index: number): ResolvedSlot | undefined => {
      const slot = slotAt(layout, index);
      if (!slot) return undefined;
      if (slot.kind === "header") return { kind: "header", group: slot.group, groupIndex: slot.groupIndex };
      const pageIndex = Math.floor(slot.childOffset / CHILD_PAGE_SIZE);
      const page = pagesRef.current.get(`${cacheKey}#${String(slot.group.key)}#${pageIndex}`);
      return {
        kind: "child",
        group: slot.group,
        groupIndex: slot.groupIndex,
        childOffset: slot.childOffset,
        row: page?.rows[slot.childOffset - pageIndex * CHILD_PAGE_SIZE],
      };
    },
    [layout, cacheKey],
  );

  const headerIndexOfGroup = useCallback((key: GroupKey) => headerIndexOf(layout, key), [layout]);

  return {
    layout,
    totalCount: layout.totalCount,
    getSlot,
    ensureRange,
    headerIndexOfGroup,
    loading: groupsLoading,
    truncated,
  };
}
