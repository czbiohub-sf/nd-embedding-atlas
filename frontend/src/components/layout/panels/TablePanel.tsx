import type { IDockviewPanelProps } from "dockview-react";
import { useCallback } from "react";
import { useDashboard } from "../../../hooks/useDashboard";
import { DataTable } from "../../table/DataTable";

const FALLBACK_TABLE_COLUMNS = ["_dataset"];

export function TablePanel(_props: IDockviewPanelProps) {
    const { state, actions, meta } = useDashboard();
    const { metadata, highlightId } = state;
    const { coordinator, brushSelection, table } = meta;

    const handleRowClick = useCallback(
        (id: string | null) => {
            actions.setHighlight(id);
        },
        [actions],
    );

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
