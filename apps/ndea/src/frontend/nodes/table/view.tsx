/**
 * Table plugin view (PLUGIN-ARCHITECTURE §10.4).
 *
 * Sources coordinator/table/metadata from `host.data`, the filter from
 * `host.inputSelection`, routes row-click through `host.highlight.set`, and
 * reads the highlight reactively via `useHighlight()` (the HighlightBus, §6.7) —
 * no `useDashboard` reach-in. `DataTable` is already fully prop-driven, so the
 * conversion is localized to this wrapper.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SortingState } from "@tanstack/react-table";
import { focusRow, publishOrdering } from "@/nodes/table/routing";
import { DataTable } from "@/nodes/table/DataTable";
import { useHighlight } from "@/hooks/useHighlight";
import type { NodeBodyProps } from "@/core/node/app-node-host";

/** The `ordering` coordination cell ⇄ TanStack `SortingState` bridge. */
type OrderingCell = { col: string; dir: "asc" | "desc" } | null;
const cellOf = (s: SortingState): OrderingCell => (s.length ? { col: s[0].id, dir: s[0].desc ? "desc" : "asc" } : null);
const sortingOf = (c: OrderingCell): SortingState => (c ? [{ id: c.col, desc: c.dir === "desc" }] : []);
const sameCell = (a: OrderingCell, b: OrderingCell): boolean => a?.col === b?.col && a?.dir === b?.dir;

export interface TableConfig {
  /** Reserved for per-instance column selection (Phase 3+). */
  columns: string[] | null;
}

export type TableOptions = Record<string, never>;

const FALLBACK_TABLE_COLUMNS = ["_dataset"];

export function TablePluginView({ host }: NodeBodyProps<TableConfig>) {
  const { coordinator, table, metadata } = host.data;
  // Reactive highlight read — re-renders the table on highlight change so the
  // current row scrolls into view. Sourced from the HighlightBus; the write
  // routes through host.highlight.set below.
  const highlightId = useHighlight();

  const handleRowClick = useCallback((id: string | null) => focusRow(host, id), [host]);

  // Sort ⇄ `ordering` coordination scope. Local when unscoped (host.ordering.set
  // is a no-op); shared when the node is on an ordering scope. The sameCell guard
  // breaks the echo when this node's own broadcast comes back through subscribe.
  const [sorting, setSorting] = useState<SortingState>(() => sortingOf(host.ordering?.get() ?? null));
  const handleSortingChange = useCallback(
    (next: SortingState) => {
      setSorting(next);
      publishOrdering(host, cellOf(next));
    },
    [host],
  );
  useEffect(() => {
    return host.ordering?.subscribe?.((cell) => {
      setSorting((prev) => (sameCell(cellOf(prev), cell) ? prev : sortingOf(cell)));
    });
  }, [host]);

  // Stable `columns` identity — metadata refresh (annotation writes) mints a
  // fresh `obs_columns` array; memoize so DataTable doesn't rebuild + re-fetch.
  const columns = useMemo(() => metadata.obs_columns ?? FALLBACK_TABLE_COLUMNS, [metadata.obs_columns]);

  return (
    <DataTable
      coordinator={coordinator}
      table={table}
      columns={columns}
      selection={host.inputPredicate}
      highlightId={highlightId}
      onRowClick={handleRowClick}
      sorting={sorting}
      onSortingChange={handleSortingChange}
      headerEl={host.bodyHeaderElement}
    />
  );
}
