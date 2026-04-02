/**
 * Custom data table with server-side pagination via DuckDB.
 *
 * Uses TanStack Table for headless table logic (sorting, column model,
 * row selection) and TanStack Virtual for rendering millions of rows
 * efficiently (only ~500 in memory at a time via page cache).
 */

import {
  type ColumnDef,
  type ColumnSizingState,
  flexRender,
  getCoreRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Row, type SortState, useTableQuery } from "./useTableQuery";

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 30;
const OVERSCAN = 15;

/** Estimate column width in px by sampling row content lengths. */
function estimateColumnWidth(name: string, rows: Row[]): number {
  const CHAR_WIDTH = 7.2;
  const PADDING = 20;
  const MIN = 60;
  const MAX = 360;

  let maxLen = name.length + 2;
  for (const row of rows) {
    const val = row[name];
    if (val == null) continue;
    const str =
      typeof val === "number"
        ? Number.isInteger(val)
          ? val.toLocaleString()
          : val.toFixed(3)
        : String(val as string | number | boolean | null);
    maxLen = Math.max(maxLen, str.length);
  }
  return Math.min(MAX, Math.max(MIN, Math.ceil(maxLen * CHAR_WIDTH + PADDING)));
}

export interface DataTableProps {
  coordinator: Coordinator;
  table: string;
  columns: string[];
  selection?: Selection;
  highlightId?: string | null;
  onRowClick?: (rowIndex: string | null) => void;
  onTotalCountChange?: (n: number) => void;
}

export function DataTable({
  coordinator,
  table,
  columns: columnNames,
  selection,
  highlightId,
  onRowClick,
  onTotalCountChange,
}: DataTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Server-side sort state (lifted into TanStack Table) ─────────
  // We store sorting in React state so changes re-render and re-query.
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const autoSizedRef = useRef(false);

  const sort: SortState | null = useMemo(() => {
    if (sorting.length === 0) return null;
    return { column: sorting[0].id, direction: sorting[0].desc ? "desc" : "asc" };
  }, [sorting]);

  // ── Server-side data ────────────────────────────────────────────
  const { totalCount, getRow, getCachedRows, ensureRange, findRowPosition } = useTableQuery({
    coordinator,
    table,
    columns: columnNames,
    selection,
    sort,
  });

  // ── Column definitions ──────────────────────────────────────────
  const tableColumns = useMemo<ColumnDef<Row>[]>(
    () =>
      columnNames.map((name) => ({
        id: name,
        accessorFn: (row: Row) => row[name],
        header: name,
        size: name.length < 6 ? 80 : name.length < 12 ? 120 : 160,
        minSize: 50,
        maxSize: 600,
        cell: (info) => {
          const val = info.getValue();
          if (val == null) return <span className="text-text-muted">—</span>;
          if (typeof val === "number") {
            return (
              <span className="tabular-nums">{Number.isInteger(val) ? val.toLocaleString() : val.toFixed(3)}</span>
            );
          }
          return (
            <span className="truncate" title={String(val as string | number | boolean | null)}>
              {String(val as string | number | boolean | null)}
            </span>
          );
        },
      })),
    [columnNames],
  );

  // ── Build visible data array from page cache ────────────────────
  // Only includes rows that are actually loaded — NOT the full dataset.
  // TanStack Table sees this small array; Virtual handles the full count.
  const visibleData = useMemo(() => getCachedRows(), [getCachedRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent when row count changes so TerminalTable header can show it
  useEffect(() => {
    onTotalCountChange?.(totalCount);
  }, [totalCount, onTotalCountChange]);

  // ── Auto-size columns from first loaded data ─────────────────
  useEffect(() => {
    if (autoSizedRef.current || visibleData.length === 0) return;
    autoSizedRef.current = true;
    const sizing: ColumnSizingState = {};
    for (const name of columnNames) {
      sizing[name] = estimateColumnWidth(name, visibleData.slice(0, 100));
    }
    setColumnSizing(sizing);
  }, [visibleData, columnNames]);

  // Reset auto-sizing when columns change
  useEffect(() => {
    autoSizedRef.current = false;
  }, []);

  // ── TanStack Table instance ─────────────────────────────────────
  const tableInstance = useReactTable({
    data: visibleData,
    columns: tableColumns,
    state: { sorting, columnSizing },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    rowCount: totalCount,
    getRowId: (row) => String(row.__row_index__ ?? row.__virtual_index__),
  });

  // ── Memoized getItemKey ─────────────────────────────────────────
  const getItemKey = useCallback((index: number) => index, []);

  // ── Double-click resize handle → auto-fit column ─────────────
  const handleAutoSizeColumn = useCallback(
    (columnId: string) => {
      const width = estimateColumnWidth(columnId, visibleData.slice(0, 100));
      setColumnSizing((prev) => ({ ...prev, [columnId]: width }));
    },
    [visibleData],
  );

  // ── Virtual scrolling ───────────────────────────────────────────
  const rowVirtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey,
    scrollMargin: HEADER_HEIGHT,
  });

  // ── Fetch visible pages on scroll ───────────────────────────────
  const virtualItems = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    if (virtualItems.length === 0) return;
    const start = virtualItems[0].index;
    const end = virtualItems[virtualItems.length - 1].index;
    ensureRange(start, end);
  }, [virtualItems, ensureRange]);

  // ── Scroll-to-highlight ─────────────────────────────────────────
  useEffect(() => {
    if (highlightId == null) return;
    void findRowPosition(highlightId).then((pos) => {
      if (pos != null) {
        rowVirtualizer.scrollToIndex(pos, { align: "center" });
        ensureRange(Math.max(0, pos - 50), pos + 50);
      }
    });
  }, [highlightId, findRowPosition, rowVirtualizer, ensureRange]);

  // ── Row click handler ───────────────────────────────────────────
  const handleRowClick = useCallback(
    (virtualIndex: number) => {
      const row = getRow(virtualIndex);
      if (!row || !onRowClick) return;
      const rowIndex = row.__row_index__;
      onRowClick(rowIndex != null ? String(rowIndex as number) : null);
    },
    [getRow, onRowClick],
  );

  // ── Render ──────────────────────────────────────────────────────
  const headerGroups = tableInstance.getHeaderGroups();
  const totalWidth = tableInstance.getTotalSize();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface font-mono text-text-primary text-xs">
      {/* Scrollable container */}
      <div ref={containerRef} className="flex-1 overflow-auto">
        {/* Sticky header via TanStack Table header groups */}
        <div
          className="sticky top-0 z-10 border-border-subtle border-b bg-base"
          style={{ height: HEADER_HEIGHT, minWidth: totalWidth }}
        >
          {headerGroups.map((headerGroup) => (
            <div key={headerGroup.id} className="flex" style={{ minWidth: totalWidth }}>
              {headerGroup.headers.map((header) => (
                <div
                  key={header.id}
                  className="group relative flex shrink-0 items-center"
                  style={{ width: header.getSize(), height: HEADER_HEIGHT }}
                >
                  <button
                    type="button"
                    className="flex h-full w-full cursor-pointer select-none items-center px-2 font-medium font-sans text-[11px] text-text-secondary hover:text-text-primary"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? null}
                  </button>
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: column resize handle is drag-only */}
                  <div
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    onDoubleClick={() => handleAutoSizeColumn(header.column.id)}
                    className={`absolute top-0 right-0 h-full w-[3px] cursor-col-resize touch-none select-none ${
                      header.column.getIsResizing() ? "bg-primary" : "bg-transparent group-hover:bg-elevated"
                    }`}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Virtual row container */}
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            minWidth: totalWidth,
            position: "relative",
          }}
        >
          {virtualItems.map((virtualRow) => {
            const row = getRow(virtualRow.index);
            const isHighlighted =
              highlightId != null && row?.__row_index__ != null && String(row.__row_index__ as number) === highlightId;

            return (
              <button
                type="button"
                key={virtualRow.key}
                data-index={virtualRow.index}
                className={`absolute flex cursor-pointer border-border-subtle/50 border-b text-left ${
                  isHighlighted ? "bg-elevated" : "hover:bg-elevated"
                }`}
                style={{
                  height: `${ROW_HEIGHT}px`,
                  minWidth: totalWidth,
                  transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                }}
                onClick={() => handleRowClick(virtualRow.index)}
              >
                {row
                  ? tableInstance.getAllColumns().map((col) => {
                      const val = row[col.id];
                      return (
                        <div
                          key={col.id}
                          className="flex shrink-0 items-center overflow-hidden px-2"
                          style={{ width: col.getSize(), height: ROW_HEIGHT }}
                        >
                          {val == null ? (
                            <span className="text-text-muted">—</span>
                          ) : typeof val === "number" ? (
                            <span className="tabular-nums">
                              {Number.isInteger(val) ? val.toLocaleString() : val.toFixed(3)}
                            </span>
                          ) : (
                            <span className="truncate" title={String(val as string | number | boolean | null)}>
                              {String(val as string | number | boolean | null)}
                            </span>
                          )}
                        </div>
                      );
                    })
                  : /* Skeleton row */
                    tableInstance.getAllColumns().map((col) => (
                      <div
                        key={col.id}
                        className="flex shrink-0 items-center px-2"
                        style={{ width: col.getSize(), height: ROW_HEIGHT }}
                      >
                        <div className="h-3 w-2/3 animate-pulse rounded bg-elevated" />
                      </div>
                    ))}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
