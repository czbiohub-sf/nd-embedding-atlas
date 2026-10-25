/**
 * Table body: the obs as rows, one column per field. Owns the field list
 * (obs from the file plus annotation fields), the unsaved edit buffer, the
 * filter builder (typed clauses on the `filter` facet), the row selection (an
 * observation set on the `selection` facet: peers narrow, this table never
 * filters itself by it), sort (`ordering`), group, and the Fields config.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AnnotationDtype, CommitAnnotationsResponse } from "@ndea/protocol";
import { rowIndex as toRowIndex } from "@ndea/sdk";
import { Button } from "@ndea/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ndea/ui/components/dialog";
import type { BodyProps } from "../contracts";
import { filterClauseSql } from "../filter/sql";
import { duckdbTypeToColumnType } from "../query/column-types";
import { toRows } from "../query/mosaic";
import { useFocus } from "../query/useFocus";
import type { TableConfig } from "./contracts";
import { DataTable, type Edits, type Provenance, type TableActions } from "./DataTable";
import {
  andSql,
  clauseConditions,
  type Condition,
  conditionsClause,
  countBits,
  emptyBits,
  fieldType,
  GroupLayout,
  hasBit,
  isStringField,
  orderBySql,
  quoteIdent,
  searchSql,
  type SortState,
  type TableField,
  withBits,
} from "./fields";
import { useProvenanceBadges } from "./provenance";
import { CommitDialog, Toolbar } from "./Toolbar";
import { useTableQuery } from "./useTableQuery";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `list` with `from` renamed to `to` (dropped when `to` is null). */
const renameIn = (list: string[] | null, from: string, to: string | null) =>
  list?.flatMap((n) => (n === from ? (to === null ? [] : [to]) : [n])) ?? null;

/** Obs from the file (the session's obs columns) and annotation fields, typed. */
function useFields(host: BodyProps<TableConfig>["host"], version: number) {
  const { coordinator, table, metadata } = host.data;
  const [fields, setFields] = useState<TableField[] | null>(null);
  const [rows, setRows] = useState(0);
  // Distinct counts never change for obs from the file: query each column once.
  const distinct = useRef(new Map<string, number>());
  useEffect(() => {
    let live = true;
    void (async () => {
      // `version` is the refetch trigger after a field write.
      void version;
      const run = async (sql: string) => toRows(await coordinator.query(sql, { cache: false }));
      const [annotations, described, counted] = await Promise.all([
        host.dataAPI.listFields(),
        run(`SELECT column_name, column_type FROM (DESCRIBE ${table})`),
        run(`SELECT count(*) AS n FROM ${table}`),
      ]);
      const types = new Map(
        described.map((r) => [String(r.column_name), duckdbTypeToColumnType(String(r.column_type))]),
      );
      const dtypes = new Map(annotations.map((a) => [a.name, a.dtype]));
      const obs = (metadata.obs_columns ?? []).filter((name) => types.has(name) && !dtypes.has(name));
      const unknown = obs.filter((name) => types.get(name) === "string" && !distinct.current.has(name));
      if (unknown.length) {
        const [row] = await run(
          `SELECT ${unknown.map((n, i) => `approx_count_distinct(${quoteIdent(n)}) AS c${i}`).join(", ")} FROM ${table}`,
        );
        unknown.forEach((n, i) => distinct.current.set(n, Number(row[`c${i}`])));
      }
      if (!live) return;
      setRows(Number(counted[0]?.n ?? 0));
      setFields([
        ...obs.map((name) => ({
          name,
          type: fieldType(types.get(name)!, distinct.current.get(name), null),
          annotation: null,
        })),
        ...annotations
          .filter((a) => types.has(a.name))
          .map((a) => ({ name: a.name, type: fieldType("string", undefined, a.dtype), annotation: a.dtype })),
      ]);
    })().catch((error) => host.notifications.notify(`Table fields failed: ${errorMessage(error)}`, "error"));
    return () => {
      live = false;
    };
  }, [host, coordinator, table, metadata, version]);
  return { fields, rows };
}

export function TableView({ host }: BodyProps<TableConfig>) {
  const { coordinator, table } = host.data;
  const focused = useFocus(host);
  const showProvenance = useProvenanceBadges();
  const [version, refresh] = useReducer((n: number) => n + 1, 0);
  const { fields, rows: nObs } = useFields(host, version);
  const byName = useMemo(() => new Map((fields ?? []).map((f) => [f.name, f])), [fields]);

  // ── Config: visible fields and grouping ─────────────────────────────
  const [config, setConfig] = useState<TableConfig>(host.config);
  const patch = useCallback(
    (next: Partial<TableConfig>) => {
      host.patchConfig(next);
      setConfig((c) => ({ ...c, ...next }));
    },
    [host],
  );
  const visibleFields = useMemo(() => {
    const listed = (config.columns ?? []).flatMap((n) => byName.get(n) ?? []);
    return listed.length ? listed : (fields ?? []);
  }, [config.columns, byName, fields]);
  const groupBy = config.groupBy && byName.has(config.groupBy) ? config.groupBy : null;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

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
  const [conditions, setConditionsState] = useState<Condition[]>(() => clauseConditions(host.filter.facet("filter")));
  const typeOf = useCallback((column: string) => byName.get(column)?.type, [byName]);
  const ownClause = useMemo(() => (fields ? conditionsClause(conditions, typeOf) : null), [fields, conditions, typeOf]);
  const published = useRef(JSON.stringify(host.filter.facet("filter") ?? null));
  useEffect(() => {
    if (!fields) return;
    const next = JSON.stringify(ownClause);
    if (next === published.current) return;
    published.current = next;
    if (ownClause) host.filter.publish("filter", ownClause);
    else host.filter.clear("filter");
  }, [host, fields, ownClause]);

  // ── What the table shows ────────────────────────────────────────────
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
  const visibleNames = useMemo(() => visibleFields.map((f) => f.name), [visibleFields]);
  const query = useTableQuery({
    coordinator,
    table,
    columns: visibleNames,
    where,
    order: orderBySql(activeSort, groupBy),
    groupBy,
    version,
  });
  const layout = useMemo(
    () => (groupBy && query.groups ? new GroupLayout(query.groups, collapsed) : null),
    [groupBy, query.groups, collapsed],
  );

  // ── Unsaved edits ───────────────────────────────────────────────────
  const [edits, setEdits] = useState<Edits>(new Map());
  const [saving, setSaving] = useState(false);
  const editCount = useMemo(() => [...edits.values()].reduce((n, m) => n + m.size, 0), [edits]);
  const save = async () => {
    setSaving(true);
    try {
      for (const [field, cells] of edits) {
        const rows = [...cells].map(([row, value]) => ({ rowIndex: toRowIndex(row), value }));
        await host.dataAPI.writeFieldValues(field, rows);
        setEdits((prev) => new Map([...prev].filter(([f]) => f !== field)));
      }
      host.notifications.notify(`Saved ${editCount.toLocaleString("en-US")} ${editCount === 1 ? "edit" : "edits"}`);
      refresh();
    } catch (error) {
      host.notifications.notify(`Save failed: ${errorMessage(error)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Selection → observation set on the `selection` facet ────────────
  const [selection, setSelection] = useState<Uint32Array<ArrayBuffer> | null>(null);
  const selected = useMemo(() => (selection ? countBits(selection) : 0), [selection]);
  const anchor = useRef<number | null>(null);
  const selectionRun = useRef(0);
  const select = useCallback(
    async (bits: Uint32Array<ArrayBuffer>) => {
      const run = ++selectionRun.current;
      const empty = countBits(bits) === 0;
      setSelection(empty ? null : bits);
      if (empty) return host.filter.clear("selection");
      try {
        const { set } = await host.dataAPI.createObservationSet(bits, nObs);
        if (run === selectionRun.current && !host.signal.aborted)
          host.filter.publish("selection", { op: "inSet", set });
      } catch (error) {
        if (!host.signal.aborted) host.notifications.notify(`Selection failed: ${errorMessage(error)}`, "error");
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

  // ── Focus: reveal the focused row ───────────────────────────────────
  const [reveal, setReveal] = useState<number | null>(null);
  const ownFocus = useRef<number | null>(null);
  const { positionOf } = query;
  useEffect(() => {
    if (focused === null || focused === ownFocus.current) return;
    let live = true;
    void positionOf(focused).then((position) => {
      if (live && position !== null) setReveal(layout ? layout.indexOf(position) : position);
    });
    return () => {
      live = false;
    };
  }, [focused, positionOf, layout]);

  // ── Field operations (applied on the server at once) ────────────────
  const [deleting, setDeleting] = useState<string | null>(null);
  const [commit, setCommit] = useState<{ report: CommitAnnotationsResponse | null; writing: boolean }>({
    report: null,
    writing: false,
  });
  const fieldOp = async (run: () => Promise<void>, failure: string) => {
    try {
      await run();
      refresh();
    } catch (error) {
      host.notifications.notify(`${failure}: ${errorMessage(error)}`, "error");
    }
  };

  const actions: TableActions = {
    sort: setSort,
    group: (field) => {
      setCollapsed(new Set());
      patch({ groupBy: field });
    },
    hide: (field) => {
      const next = visibleNames.filter((n) => n !== field);
      if (next.length) patch({ columns: next });
    },
    addField: (name, dtype) =>
      void fieldOp(async () => {
        await host.dataAPI.createField(name, dtype);
        if (config.columns) patch({ columns: [...config.columns, name] });
      }, `Adding ${name} failed`),
    renameField: (from, to) =>
      void fieldOp(async () => {
        await host.dataAPI.updateField(from, { name: to });
        setEdits((prev) => new Map([...prev].map(([f, cells]) => [f === from ? to : f, cells])));
        if (config.columns) patch({ columns: renameIn(config.columns, from, to) });
        if (groupBy === from) patch({ groupBy: to });
        if (activeSort?.col === from) setSort({ ...activeSort, col: to });
        setConditionsState((cs) => cs.map((c) => (c.column === from ? { ...c, column: to } : c)));
      }, `Renaming ${from} failed`),
    convertField: (name, dtype: AnnotationDtype) =>
      void fieldOp(() => host.dataAPI.updateField(name, { dtype }), `Converting ${name} failed`),
    deleteField: setDeleting,
    values: async (field) => {
      const saved = toRows(
        await coordinator.query(
          `SELECT DISTINCT ${quoteIdent(field)} AS v FROM ${table} WHERE ${quoteIdent(field)} IS NOT NULL ORDER BY 1 LIMIT 500`,
          { cache: false },
        ),
      ).map((r) => String(r.v));
      const pending = [...(edits.get(field)?.values() ?? [])].filter((v): v is string => v !== null);
      return [...new Set([...saved, ...pending])].toSorted();
    },
    edit: (field, row, value, saved) =>
      setEdits((prev) => {
        const cells = new Map(prev.get(field));
        if (value === saved) cells.delete(row);
        else cells.set(row, value);
        const next = new Map(prev);
        if (cells.size) next.set(field, cells);
        else next.delete(field);
        return next;
      }),
    clickRow: (position, row, event) => {
      const base = selection ?? emptyBits(nObs);
      if (event.shiftKey && anchor.current !== null) {
        const from = Math.min(anchor.current, position);
        void query
          .rowIndices(from, Math.abs(position - anchor.current) + 1)
          .then((rows) => select(withBits(base, rows, true)));
      } else if (event.metaKey || event.ctrlKey) {
        void select(withBits(base, [row], !hasBit(base, row)));
      } else {
        ownFocus.current = row;
        host.focus.set(toRowIndex(row));
      }
      anchor.current = position;
    },
    toggleRow: (row) => {
      const base = selection ?? emptyBits(nObs);
      void select(withBits(base, [row], !hasBit(base, row)));
    },
    toggleAll: () => {
      if (selected > 0) return void select(emptyBits(nObs));
      void query.rowIndices().then((rows) => select(withBits(emptyBits(nObs), rows, true)));
    },
    toggleGroup: (key) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
  };

  const provenance = (field: TableField): Provenance =>
    field.annotation === null ? "obs" : edits.get(field.name)?.size ? "unsaved" : "saved";

  if (!fields) return <div className="h-full w-full bg-surface" />;
  const fieldNames = fields.filter((f) => f.annotation).map((f) => f.name);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface text-ui">
      <Toolbar
        fields={fields}
        visible={visibleNames}
        search={search}
        onSearch={setSearch}
        conditions={conditions}
        onConditions={setConditionsState}
        sort={activeSort}
        onSort={setSort}
        groupBy={groupBy}
        onGroup={actions.group}
        onColumns={(next) => patch({ columns: next })}
        values={actions.values}
        count={query.count}
        selected={selected}
        onClearSelection={() => void select(emptyBits(nObs))}
        edits={editCount}
        saving={saving}
        onSave={() => void save()}
        onDiscard={() => setEdits(new Map())}
        canWrite={fieldNames.length > 0}
        onWrite={() =>
          void host.dataAPI.commitFields({ dryRun: true, columns: fieldNames }).then(
            (report) => setCommit({ report, writing: false }),
            (error) => host.notifications.notify(`Dry run failed: ${errorMessage(error)}`, "error"),
          )
        }
      />
      <DataTable
        fields={visibleFields}
        query={query}
        layout={layout}
        sort={activeSort}
        groupBy={groupBy}
        focused={focused === null ? null : Number(focused)}
        reveal={reveal}
        selection={selection}
        selected={selected}
        edits={edits}
        provenance={showProvenance ? provenance : null}
        actions={actions}
      />
      <CommitDialog
        report={commit.report}
        writing={commit.writing}
        onClose={() => setCommit({ report: null, writing: false })}
        onConfirm={() => {
          setCommit((c) => ({ ...c, writing: true }));
          host.dataAPI.commitFields({ dryRun: false, columns: fieldNames }).then(
            (report) => {
              const written = report.datasets.filter((d) => !("error" in d)).length;
              host.notifications.notify(
                `Wrote ${fieldNames.length} fields to ${written} file${written === 1 ? "" : "s"}`,
              );
              setCommit({ report: null, writing: false });
            },
            (error) => {
              host.notifications.notify(`Writing fields failed: ${errorMessage(error)}`, "error");
              setCommit((c) => ({ ...c, writing: false }));
            },
          );
        }}
      />
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleting}?</DialogTitle>
            <DialogDescription>
              The field and all its saved values are removed. Fields already written to the file stay there.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const name = deleting!;
                setDeleting(null);
                void fieldOp(async () => {
                  await host.dataAPI.deleteField(name);
                  setEdits((prev) => new Map([...prev].filter(([f]) => f !== name)));
                  if (config.columns) patch({ columns: renameIn(config.columns, name, null) });
                  if (groupBy === name) patch({ groupBy: null });
                  if (activeSort?.col === name) setSort(null);
                  setConditionsState((cs) => cs.filter((c) => c.column !== name));
                }, `Deleting ${name} failed`);
              }}
            >
              Delete field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
