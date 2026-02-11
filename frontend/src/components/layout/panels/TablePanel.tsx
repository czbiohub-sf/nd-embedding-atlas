import type { IDockviewPanelProps } from "dockview-react";
import { Table } from "embedding-atlas/react";
import { useCallback, useMemo } from "react";
import { useDashboard } from "../../../hooks/useDashboard";

const FALLBACK_TABLE_COLUMNS = ["_dataset"];

const TABLE_THEME = {
    primaryTextColor: "#e2e8f0",
    secondaryTextColor: "#8892b0",
    tertiaryTextColor: "#4a5278",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: "12px",
    primaryBackgroundColor: "#141829",
    secondaryBackgroundColor: "#0c1021",
    hoverBackgroundColor: "rgba(255, 255, 255, 0.05)",
    headerFontFamily: "DM Sans, system-ui",
    headerFontSize: "12px",
    scrollbarBackgroundColor: "rgba(255, 255, 255, 0.05)",
    scrollbarPillColor: "rgba(255, 255, 255, 0.3)",
    outlineColor: "#242a45",
    rowHoverColor: "#1a1f36",
    rowScrollToColor: "#242a45",
} as const;

export function TablePanel(_props: IDockviewPanelProps) {
    const { state, actions, meta } = useDashboard();
    const { metadata, highlightId } = state;
    const { coordinator, brushSelection, table } = meta;

    const handleRowClick = useCallback(
        (id: string | number | null) => {
            actions.setHighlight(id != null ? String(id) : null);
        },
        [actions],
    );

    const highlightedRows = useMemo(() => (highlightId ? [highlightId] : null), [highlightId]);

    return (
        <div className="flex h-full w-full overflow-hidden [&>div]:h-full [&>div]:w-full">
            <Table
                coordinator={coordinator}
                table={table}
                columns={metadata.obs_columns ?? FALLBACK_TABLE_COLUMNS}
                rowKey="__row_index__"
                filter={brushSelection}
                scrollTo={highlightId}
                highlightedRows={highlightedRows}
                highlightHoveredRow
                colorScheme="dark"
                theme={TABLE_THEME}
                onRowClick={handleRowClick}
            />
        </div>
    );
}
