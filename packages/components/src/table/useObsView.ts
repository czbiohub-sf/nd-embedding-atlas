/**
 * The obs engine the table and the gallery share: the field list (obs from
 * the file plus annotation fields), search, the filter builder (typed clauses
 * on the `filter` facet), sort (`ordering`), groups, the paged query, the row
 * selection (an observation set on the `selection` facet: peers narrow, the
 * view never filters itself by it) and focus. Each view draws the rows its own
 * way; the table adds edits and field operations on top.
 */

import type { MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { quoteIdent } from "@ndea/protocol";
import { type ComponentHost, rowIndex as toRowIndex } from "@ndea/sdk";
import { filterClauseSql } from "../filter/sql";
import { useColumns } from "../query/columns";
import { toRows } from "../query/mosaic";
import { useFocus } from "../query/useFocus";
import {
  andSql,
  clauseConditions,
  clauseConjunction,
  type Condition,
  type Conjunction,
  conditionsClause,
  countBits,
  emptyBits,
  fieldType,
  hasBit,
  isStringField,
  orderBySql,
  searchSql,
  type SortState,
  type TableField,
  withBits,
} from "./fields";
import { useTableQuery } from "./useTableQuery";

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The column catalog minus var columns: obs from the file read-only, annotation fields editable. */
function useFields(host: ComponentHost, version: number) {
  const { coordinator, table } = host.data;
  const columns = useColumns();
  const [fields, setFields] = useState<TableField[] | null>(null);
  const [rows, setRows] = useState(0);
  // Distinct counts never change for obs from the file: query each column once.
  const distinct = useRef(new Map<string, number>());
  useEffect(() => {
    if (!columns) return;
    let live = true;
    void (async () => {
      // `version` is the refetch trigger after a field write.
      void version;
      const run = async (sql: string) => toRows(await coordinator.query(sql, { cache: false }));
      const [annotations, counted] = await Promise.all([
        host.dataAPI.listFields(),
        run(`SELECT count(*) AS n FROM ${table}`),
      ]);
      const dtypes = new Map(annotations.map((a) => [a.name, a.dtype]));
      const listed = [...columns.values()].filter((c) => c.kind !== "var");
      const unknown = listed
        .filter((c) => c.kind === "obs" && c.type === "string" && !distinct.current.has(c.name))
        .map((c) => c.name);
      if (unknown.length) {
        const [row] = await run(
          `SELECT ${unknown.map((n, i) => `approx_count_distinct(${quoteIdent(n)}) AS c${i}`).join(", ")} FROM ${table}`,
        );
        unknown.forEach((n, i) => distinct.current.set(n, Number(row[`c${i}`])));
      }
      if (!live) return;
      setRows(Number(counted[0]?.n ?? 0));
      setFields(
        listed.flatMap(({ name, type, kind }): TableField[] => {
          if (kind === "obs")
            return [{ name, type: fieldType(type, distinct.current.get(name), null), annotation: null }];
          const dtype = dtypes.get(name);
          return dtype ? [{ name, type: fieldType("string", undefined, dtype), annotation: dtype }] : [];
        }),
      );
    })().catch((error) => host.notifications.notify(`Fields failed: ${errorMessage(error)}`, "error"));
    return () => {
      live = false;
    };
  }, [host, coordinator, table, columns, version]);
  return { fields, rows };
}

export interface ObsViewOptions {
  /** Shown fields in order; null shows every field. */
  readonly columns: readonly string[] | null;
  /** The table shows every field when none of `columns` exists; the gallery shows none. */
  readonly emptyShowsAll: boolean;
  /** Group fields, outermost first; names the catalog lacks are dropped. */
  readonly groupBy: readonly string[];
  /** Columns the page query reads besides the shown fields (catalog names or internal columns). */
  readonly extra?: readonly string[];
}

export function useObsView(host: ComponentHost, options: ObsViewOptions) {
  const { coordinator, table } = host.data;
  const focused = useFocus(host);
  const [version, refresh] = useReducer((n: number) => n + 1, 0);
  const { fields, rows: nObs } = useFields(host, version);
  const byName = useMemo(() => new Map((fields ?? []).map((f) => [f.name, f])), [fields]);

  const visibleFields = useMemo(() => {
    if (options.columns === null) return fields ?? [];
    const listed = options.columns.flatMap((n) => byName.get(n) ?? []);
    return listed.length || !options.emptyShowsAll ? listed : (fields ?? []);
  }, [options.columns, options.emptyShowsAll, byName, fields]);
  const visibleNames = useMemo(() => visibleFields.map((f) => f.name), [visibleFields]);
  const groupKeyText = options.groupBy.filter((g) => byName.has(g)).join("\u0000");
  const groupBy = useMemo(() => (groupKeyText ? groupKeyText.split("\u0000") : []), [groupKeyText]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = useCallback(
    (key: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );

  // ── Sort ⇄ the `ordering` link (echo-guarded) ───────────────────────
  const [sort, setSortState] = useState<SortState | null>(() => host.ordering.get());
  useEffect(
    () =>
      host.ordering.subscribe?.((cell) =>
        setSortState((prev) => (prev?.col === cell?.col && prev?.dir === cell?.dir ? prev : cell)),
      ),
    [host],
  );
  const setSort = useCallback(
    (next: SortState | null) => {
      setSortState(next);
      host.ordering.set(next);
    },
    [host],
  );
  const activeSort = sort && byName.has(sort.col) ? sort : null;

  // ── Filter builder → typed clauses on the `filter` facet ────────────
  const [conditions, setConditions] = useState<Condition[]>(() => clauseConditions(host.filter.facet("filter")));
  const [conjunction, setConjunction] = useState<Conjunction>(() => clauseConjunction(host.filter.facet("filter")));
  const typeOf = useCallback((column: string) => byName.get(column)?.type, [byName]);
  const ownClause = useMemo(
    () => (fields ? conditionsClause(conditions, typeOf, conjunction) : null),
    [fields, conditions, typeOf, conjunction],
  );
  const published = useRef(JSON.stringify(host.filter.facet("filter") ?? null));
  useEffect(() => {
    if (!fields) return;
    const next = JSON.stringify(ownClause);
    if (next === published.current) return;
    published.current = next;
    if (ownClause) host.filter.publish("filter", ownClause);
    else host.filter.clear("filter");
  }, [host, fields, ownClause]);

  // ── What the view shows ─────────────────────────────────────────────
  const [peers, setPeers] = useState(() => host.filter.getResolved().predicate);
  useEffect(() => host.filter.subscribeResolved((f) => setPeers(f.predicate)), [host]);
  const [search, setSearch] = useState("");
  const searched = useMemo(
    () =>
      searchSql(
        search,
        (fields ?? []).filter((f) => isStringField(f.type)).map((f) => f.name),
      ),
    [search, fields],
  );
  const where = andSql([peers, ownClause ? filterClauseSql(ownClause) : null, searched]);
  const extraText = (options.extra ?? []).join("\u0000");
  const readNames = useMemo(
    () => [...new Set([...visibleNames, ...(extraText ? extraText.split("\u0000") : [])])],
    [visibleNames, extraText],
  );
  const query = useTableQuery({
    coordinator,
    table,
    columns: readNames,
    where,
    order: orderBySql(activeSort, groupBy),
    groupBy,
    version,
  });

  // ── Selection → observation set on the `selection` facet ────────────
  const [selection, setSelection] = useState<Uint32Array<ArrayBuffer> | null>(null);
  const selected = useMemo(() => (selection ? countBits(selection) : 0), [selection]);
  const anchor = useRef<number | null>(null);
  /** Bumped by every selection; the reload restore below yields to any. */
  const selectionRun = useRef(0);
  /** The latest selection still on its way; the next one aborts it. */
  const pendingSelection = useRef<AbortController | null>(null);
  const select = useCallback(
    async (bits: Uint32Array<ArrayBuffer>) => {
      selectionRun.current += 1;
      const empty = countBits(bits) === 0;
      setSelection(empty ? null : bits);
      pendingSelection.current?.abort();
      const pending = new AbortController();
      pendingSelection.current = pending;
      try {
        await host.filter.publishSelection("selection", empty ? null : bits, nObs, pending.signal);
      } catch (error) {
        if (!host.signal.aborted && !pending.signal.aborted)
          host.notifications.notify(`Selection failed: ${errorMessage(error)}`, "error");
      }
    },
    [host, nObs],
  );
  // A selection published before a reload comes back from its set.
  useEffect(() => {
    const own = host.filter.facet("selection");
    if (!nObs || own?.op !== "inSet") return;
    void coordinator
      .query(`SELECT __row_index__ FROM ${table} WHERE ${filterClauseSql(own)}`, { cache: false })
      .then((rows) => {
        if (selectionRun.current === 0)
          setSelection(
            withBits(
              emptyBits(nObs),
              toRows(rows).map((r) => Number(r.__row_index__)),
              true,
            ),
          );
      });
  }, [host, coordinator, table, nObs]);

  // ── Focus: a request to reveal the focused obs, once per focus from elsewhere ──
  const [reveal, setReveal] = useState<{ readonly position: number } | null>(null);
  const ownFocus = useRef<number | null>(null);
  const { positionOf } = query;
  useEffect(() => {
    if (focused === null || focused === ownFocus.current) return;
    let live = true;
    void positionOf(focused).then((position) => {
      if (live && position !== null) setReveal({ position });
    });
    return () => {
      live = false;
    };
  }, [focused, positionOf]);

  const toggleRow = (row: number) => {
    const base = selection ?? emptyBits(nObs);
    void select(withBits(base, [row], !hasBit(base, row)));
  };

  return {
    fields,
    byName,
    nObs,
    refresh,
    visibleFields,
    visibleNames,
    groupBy,
    collapsed,
    setCollapsed,
    toggleGroup,
    sort: activeSort,
    setSort,
    conditions,
    setConditions,
    conjunction,
    setConjunction,
    search,
    setSearch,
    where,
    query,
    focused: focused === null ? null : Number(focused),
    reveal,
    selection,
    selected,
    clearSelection: () => void select(emptyBits(nObs)),
    /** Click: focus; shift-click: select the range from the last click; ⌘/ctrl-click: toggle. */
    clickRow: (position: number, row: number, event: Pick<MouseEvent, "shiftKey" | "metaKey" | "ctrlKey">) => {
      const base = selection ?? emptyBits(nObs);
      if (event.shiftKey && anchor.current !== null) {
        const from = Math.min(anchor.current, position);
        void query
          .rowIndices(from, Math.abs(position - anchor.current) + 1)
          .then((rows) => select(withBits(base, rows, true)));
      } else if (event.metaKey || event.ctrlKey) {
        toggleRow(row);
      } else {
        ownFocus.current = row;
        host.focus.set(toRowIndex(row));
      }
      anchor.current = position;
    },
    toggleRow,
    toggleAll: () => {
      if (selected > 0) return void select(emptyBits(nObs));
      void query.rowIndices().then((rows) => select(withBits(emptyBits(nObs), rows, true)));
    },
    /** A field's saved values (first 500, sorted) for the filter builder and label pickers. */
    values: async (field: string) =>
      toRows(
        await coordinator.query(
          `SELECT DISTINCT ${quoteIdent(field)} AS v FROM ${table} WHERE ${quoteIdent(field)} IS NOT NULL ORDER BY 1 LIMIT 500`,
          { cache: false },
        ),
      ).map((r) => String(r.v)),
  };
}

export type ObsView = ReturnType<typeof useObsView>;
