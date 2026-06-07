/**
 * Table plugin view (PLUGIN-ARCHITECTURE §10.4).
 *
 * Sources coordinator/table/metadata from `host.data`, the filter from
 * `host.inputSelection`, routes row-click through `host.highlight.set`, and
 * reads the highlight reactively via `useHighlight()` (the HighlightBus, §6.7) —
 * no `useDashboard` reach-in. `DataTable` is already fully prop-driven, so the
 * conversion is localized to this wrapper.
 */

import { useCallback } from "react";
import { DataTable } from "@/components/table/DataTable";
import { useHighlight } from "@/hooks/useHighlight";
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
  // current row scrolls into view. Sourced from the HighlightBus; the write
  // routes through host.highlight.set below.
  const highlightId = useHighlight();

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
