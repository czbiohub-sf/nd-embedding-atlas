/**
 * Table body: the obs as rows, one column per field. The shared obs engine
 * (`useObsView`) owns fields, search, filter, sort, groups, selection and
 * focus; the table adds the unsaved edit buffer, field operations, column
 * widths and the Fields config.
 */

import { useCallback, useMemo, useState } from "react";
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
import type { TableConfig } from "./contracts";
import { DataTable, type Edits, type Provenance, type TableActions } from "./DataTable";
import { GroupLayout, type TableField } from "./fields";
import { useProvenanceBadges } from "./provenance";
import { CommitDialog, EditControls, Toolbar } from "./Toolbar";
import { errorMessage, useObsView } from "./useObsView";

/** `list` with `from` renamed to `to` (dropped when `to` is null). */
const renameIn = (list: string[] | null, from: string, to: string | null) =>
  list?.flatMap((n) => (n === from ? (to === null ? [] : [to]) : [n])) ?? null;

export function TableView({ host }: BodyProps<TableConfig>) {
  const showProvenance = useProvenanceBadges();

  // ── Config: visible fields, grouping, widths ────────────────────────
  const [config, setConfig] = useState<TableConfig>(host.config);
  const patch = useCallback(
    (next: Partial<TableConfig>) => {
      host.patchConfig(next);
      setConfig((c) => ({ ...c, ...next }));
    },
    [host],
  );
  const view = useObsView(host, { columns: config.columns, emptyShowsAll: true, groupBy: config.groupBy });
  const {
    fields,
    query,
    visibleFields,
    visibleNames,
    collapsed,
    sort: activeSort,
    setSort,
    selection,
    selected,
  } = view;
  const { groupBy } = view;
  const layout = useMemo(
    () => (groupBy.length && query.groups ? new GroupLayout(query.groups, collapsed) : null),
    [groupBy.length, query.groups, collapsed],
  );
  // One index per request (state set while rendering): a later layout change must not re-reveal.
  const [reveal, setReveal] = useState<{ request: object; index: number } | null>(null);
  if (view.reveal && view.reveal !== reveal?.request)
    setReveal({
      request: view.reveal,
      index: layout ? layout.indexOf(view.reveal.position) : view.reveal.position,
    });

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
      view.refresh();
    } catch (error) {
      host.notifications.notify(`Save failed: ${errorMessage(error)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Field operations (applied on the server at once) ────────────────
  const [deleting, setDeleting] = useState<string | null>(null);
  const [commit, setCommit] = useState<{ report: CommitAnnotationsResponse | null; writing: boolean }>({
    report: null,
    writing: false,
  });
  const fieldOp = async (run: () => Promise<void>, failure: string) => {
    try {
      await run();
      view.refresh();
    } catch (error) {
      host.notifications.notify(`${failure}: ${errorMessage(error)}`, "error");
    }
  };

  const values = async (field: string) => {
    const pending = [...(edits.get(field)?.values() ?? [])].filter((v): v is string => v !== null);
    return [...new Set([...(await view.values(field)), ...pending])].toSorted();
  };

  const actions: TableActions = {
    sort: setSort,
    group: (next) => {
      view.setCollapsed(new Set());
      patch({ groupBy: next });
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
        if (groupBy.includes(from)) patch({ groupBy: renameIn(groupBy, from, to) ?? [] });
        if (from in config.widths) {
          const { [from]: width, ...rest } = config.widths;
          patch({ widths: { ...rest, [to]: width } });
        }
        if (activeSort?.col === from) setSort({ ...activeSort, col: to });
        view.setConditions((cs) => cs.map((c) => (c.column === from ? { ...c, column: to } : c)));
      }, `Renaming ${from} failed`),
    convertField: (name, dtype: AnnotationDtype) =>
      void fieldOp(() => host.dataAPI.updateField(name, { dtype }), `Converting ${name} failed`),
    deleteField: setDeleting,
    resizeField: (name, px) => {
      const { [name]: _old, ...rest } = config.widths;
      patch({ widths: px === null ? rest : { ...rest, [name]: px } });
    },
    values,
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
    clickRow: view.clickRow,
    toggleRow: view.toggleRow,
    toggleAll: view.toggleAll,
    toggleGroup: view.toggleGroup,
  };

  const provenance = (field: TableField): Provenance =>
    field.annotation === null ? "obs" : edits.get(field.name)?.size ? "unsaved" : "saved";

  if (!fields) return <div className="h-full w-full bg-surface" />;
  const fieldNames = fields.filter((f) => f.annotation).map((f) => f.name);
  const hidden = fields.length - visibleNames.length;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface text-ui">
      <Toolbar
        view={view}
        values={values}
        onGroup={actions.group}
        fieldsLabel={hidden > 0 ? `${hidden} hidden` : "Fields"}
        fieldsActive={hidden > 0}
        onColumns={(next) => next?.length !== 0 && patch({ columns: next })}
      >
        <EditControls
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
      </Toolbar>
      <DataTable
        fields={visibleFields}
        query={query}
        layout={layout}
        sort={activeSort}
        groupBy={groupBy}
        focused={view.focused}
        reveal={reveal}
        selection={selection}
        selected={selected}
        edits={edits}
        widths={config.widths}
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
                  if (groupBy.includes(name)) patch({ groupBy: renameIn(groupBy, name, null) ?? [] });
                  if (activeSort?.col === name) setSort(null);
                  view.setConditions((cs) => cs.filter((c) => c.column !== name));
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
