/**
 * Table plugin view (PLUGIN-ARCHITECTURE §10.4).
 *
 * Phase 1: replicates the existing `TablePanel` wiring (reactive `highlightId`
 * via `useDashboard`) so behavior is identical. Phase 3 routes
 * coordinator/table/selection through `host.data` / `host.inputSelection` and
 * `onRowClick` through `host.highlight.set`.
 */

import { useCallback } from "react";
import { DataTable } from "@/components/table/DataTable";
import { useDashboard } from "@/hooks/useDashboard";
import type { PluginViewProps } from "@/core/plugin/types";

export interface TableConfig {
  /** Reserved for per-instance column selection (Phase 3). */
  columns: string[] | null;
}

export type TableOptions = Record<string, never>;

const FALLBACK_TABLE_COLUMNS = ["_dataset"];

export function TablePluginView(_props: PluginViewProps<TableConfig, TableOptions>) {
  const { state, actions, meta } = useDashboard();
  const { metadata, highlightId } = state;
  const { coordinator, brushSelection, table } = meta;

  const handleRowClick = useCallback((id: string | null) => actions.setHighlight(id), [actions]);

  return (
    <DataTable
      coordinator={coordinator}
      table={table}
      columns={metadata.obs_columns ?? FALLBACK_TABLE_COLUMNS}
      selection={brushSelection}
      highlightId={highlightId}
      onRowClick={handleRowClick}
    />
  );
}
