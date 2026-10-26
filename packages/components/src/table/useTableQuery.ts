/**
 * Server-side paging over DuckDB: the obs count, the groups (a `GROUP BY`
 * query) and 100-row pages in the table's order. Every query skips Mosaic's
 * cache, because field edits change values under the same SQL.
 */

import type { Coordinator } from "@uwdata/mosaic-core";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { quoteIdent } from "@ndea/protocol";
import { toRows } from "../query/mosaic";
import type { Group, GroupValue } from "./fields";

const PAGE_SIZE = 100;
// ponytail: whole-page FIFO eviction; enough to bound memory while scrolling.
const MAX_PAGES = 24;

export type Row = Record<string, unknown>;

export interface TableQueryOptions {
  readonly coordinator: Coordinator;
  readonly table: string;
  /** Visible fields, in order. */
  readonly columns: readonly string[];
  /** WHERE expression: the data source and peer filters, the table's own filter, the search. */
  readonly where: string | null;
  /** ORDER BY body (`orderBySql`). */
  readonly order: string;
  readonly groupBy: string | null;
  /** Bump to refetch after a write. */
  readonly version: number;
}

export interface TableQuery {
  /** Matching obs (the last answer while a new query runs); null before the first. */
  readonly count: number | null;
  /** Groups in order when grouped; null otherwise or before the first answer. */
  readonly groups: readonly Group[] | null;
  /** The row at `position` in the query's order, when its page is loaded. */
  getRow(position: number): Row | undefined;
  /** Load the pages covering `first … last` (plus one page either side). */
  ensureRange(first: number, last: number): void;
  /** Position of a row in the query's order; null when it doesn't match. */
  positionOf(rowIndex: number): Promise<number | null>;
  /** Row indices in the query's order: all of them, or `limit` from `offset`. */
  rowIndices(offset?: number, limit?: number): Promise<number[]>;
}

export function useTableQuery({
  coordinator,
  table,
  columns,
  where,
  order,
  groupBy,
  version,
}: TableQueryOptions): TableQuery {
  const whereSql = where ? ` WHERE ${where}` : "";
  const key = [version, whereSql, order, groupBy, columns.join("\u0000")].join("\n");
  const run = useCallback(async (sql: string) => toRows(await coordinator.query(sql, { cache: false })), [coordinator]);

  const [summary, setSummary] = useState<{ key: string; count: number; groups: Group[] | null } | null>(null);
  // A new key gets fresh pages; answers for an old key land in its orphaned maps.
  // oxlint-disable-next-line react/exhaustive-deps -- key is the cache identity
  const pages = useMemo(() => ({ rows: new Map<number, Row[]>(), pending: new Set<number>() }), [key]);
  const [, loaded] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let live = true;
    // Debounced so typing a search or dragging a lasso elsewhere queries once.
    const timer = setTimeout(async () => {
      try {
        const g = groupBy ? quoteIdent(groupBy) : null;
        const [counted, grouped] = await Promise.all([
          run(`SELECT count(*) AS n FROM ${table}${whereSql}`),
          g
            ? run(`SELECT ${g} AS v, count(*) AS n FROM ${table}${whereSql} GROUP BY 1 ORDER BY 1 ASC NULLS LAST`)
            : null,
        ]);
        if (!live) return;
        setSummary({
          key,
          count: Number(counted[0]?.n ?? 0),
          groups: grouped?.map((r) => ({ value: (r.v ?? null) as GroupValue, count: Number(r.n) })) ?? null,
        });
      } catch (error) {
        if (live) console.error("[table] count failed", error);
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, run, table, whereSql, groupBy]);

  const ready = summary?.key === key;
  const columnList = columns.map(quoteIdent).join(", ");

  const ensureRange = useCallback(
    (first: number, last: number) => {
      if (!ready) return;
      const state = pages;
      for (
        let page = Math.max(0, Math.floor(first / PAGE_SIZE) - 1);
        page <= Math.floor(last / PAGE_SIZE) + 1;
        page++
      ) {
        if (state.rows.has(page) || state.pending.has(page) || page * PAGE_SIZE >= summary.count) continue;
        state.pending.add(page);
        const sql =
          `SELECT __row_index__${columnList ? `, ${columnList}` : ""} FROM ${table}${whereSql} ` +
          `ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`;
        run(sql)
          .then((rows) => {
            if (state.rows.size >= MAX_PAGES) state.rows.delete(state.rows.keys().next().value!);
            state.rows.set(page, rows);
            loaded();
          })
          .catch((error) => console.error("[table] page failed", error))
          .finally(() => state.pending.delete(page));
      }
    },
    [ready, summary, pages, columnList, table, whereSql, order, run],
  );

  const positionOf = useCallback(
    async (rowIndex: number) => {
      const rows = await run(
        `SELECT pos FROM (SELECT __row_index__, row_number() OVER (ORDER BY ${order}) - 1 AS pos ` +
          `FROM ${table}${whereSql}) WHERE __row_index__ = ${rowIndex}`,
      );
      return rows.length ? Number(rows[0].pos) : null;
    },
    [run, order, table, whereSql],
  );

  const rowIndices = useCallback(
    async (offset?: number, limit?: number) => {
      const page = limit === undefined ? "" : ` ORDER BY ${order} LIMIT ${limit} OFFSET ${offset ?? 0}`;
      const rows = await run(`SELECT __row_index__ FROM ${table}${whereSql}${page}`);
      return rows.map((r) => Number(r.__row_index__));
    },
    [run, order, table, whereSql],
  );

  return {
    count: summary?.count ?? null,
    groups: groupBy ? (summary?.groups ?? null) : null,
    getRow: (position) => pages.rows.get(Math.floor(position / PAGE_SIZE))?.[position % PAGE_SIZE],
    ensureRange,
    positionOf,
    rowIndices,
  };
}
