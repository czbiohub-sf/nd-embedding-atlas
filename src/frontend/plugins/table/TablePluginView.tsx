/**
 * Table plugin view (PLUGIN-ARCHITECTURE §10.4).
 *
 * Sources coordinator/table/metadata from `host.data`, the filter from
 * `host.inputSelection`, and routes row-click through `host.highlight.set`. The
 * highlight READ stays reactive via core `DashboardState` — `host.highlight.get()`
 * is a non-reactive ref, and highlight lives on core state until the Phase-4
 * HighlightBus (§6.7, decision #2). `DataTable` is already fully prop-driven, so
 * the conversion is localized to this wrapper.
 */

import { useCallback } from "react";
import { DataTable } from "@/components/table/DataTable";
import { useDashboard } from "@/hooks/useDashboard";
import type { PluginViewProps } from "@/core/plugin/types";

export interface TableConfig {
  /** Reserved for per-instance column selection (Phase 3+). */
  columns: string[] | null;
}

export type TableOptions = Record<string, never>;

const FALLBACK_TABLE_COLUMNS = ["_dataset"];

export function TablePluginView({ host }: PluginViewProps<TableConfig, TableOptions>) {
  const { coordinator, table, metadata } = host.data;
  // Reactive highlight read — re-renders the table on highlight change so the
  // current row scrolls into view (the reactive source is core state until the
  // Phase-4 HighlightBus; the write routes through the host below).
  const highlightId = useDashboard().state.highlightId;

  const handleRowClick = useCallback((id: string | null) => host.highlight.set(id), [host]);

  return (
    <DataTable
      coordinator={coordinator}
      table={table}
      columns={metadata.obs_columns ?? FALLBACK_TABLE_COLUMNS}
      selection={host.inputSelection}
      highlightId={highlightId}
      onRowClick={handleRowClick}
    />
  );
}
