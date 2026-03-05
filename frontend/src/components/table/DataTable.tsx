/**
 * Custom data table with server-side pagination via DuckDB.
 *
 * Uses TanStack Table for headless table logic (sorting, column model,
 * row selection) and TanStack Virtual for rendering millions of rows
 * efficiently (only ~500 in memory at a time via page cache).
 */

import { type ColumnDef, flexRender, getCoreRowModel, type SortingState, useReactTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { type Row, type SortState, useTableQuery } from "./useTableQuery";

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 30;
const OVERSCAN = 15;

export interface DataTableProps {
    coordinator: Coordinator;
    table: string;
    columns: string[];
    selection?: Selection;
    highlightId?: string | null;
    onRowClick?: (rowIndex: string | null) => void;
}

export function DataTable({
    coordinator,
    table,
    columns: columnNames,
    selection,
    highlightId,
    onRowClick,
}: DataTableProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    // ── Server-side sort state (lifted into TanStack Table) ─────────
    // We store sorting in TanStack Table's state but execute it server-side.
    const sortingRef = useRef<SortingState>([]);

    const sort: SortState | null = useMemo(() => {
        const s = sortingRef.current;
        if (s.length === 0) return null;
        return { column: s[0].id, direction: s[0].desc ? "desc" : "asc" };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Server-side data ────────────────────────────────────────────
    const { totalCount, getRow, ensureRange, loading, findRowPosition } = useTableQuery({
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
                cell: (info) => {
                    const val = info.getValue();
                    if (val == null) return <span className="text-[#4a5278]">—</span>;
                    if (typeof val === "number") {
                        return (
                            <span className="tabular-nums">
                                {Number.isInteger(val) ? val.toLocaleString() : val.toFixed(3)}
                            </span>
                        );
                    }
                    return (
                        <span className="truncate" title={String(val)}>
                            {String(val)}
                        </span>
                    );
                },
            })),
        [columnNames],
    );

    // ── Build visible data array from page cache ────────────────────
    // Only includes rows that are actually loaded — NOT the full dataset.
    // TanStack Table sees this small array; Virtual handles the full count.
    const visibleData = useMemo(() => {
        const rows: Row[] = [];
        for (let i = 0; i < totalCount; i++) {
            const row = getRow(i);
            if (row) rows.push(row);
        }
        return rows;
    }, [totalCount, getRow]);

    // ── TanStack Table instance ─────────────────────────────────────
    const tableInstance = useReactTable({
        data: visibleData,
        columns: tableColumns,
        state: { sorting: sortingRef.current },
        onSortingChange: (updater) => {
            const next = typeof updater === "function" ? updater(sortingRef.current) : updater;
            sortingRef.current = next;
            // Force re-render to propagate sort change to useTableQuery
            containerRef.current?.dispatchEvent(new Event("sort-change"));
        },
        getCoreRowModel: getCoreRowModel(),
        manualSorting: true,
        manualFiltering: true,
        manualPagination: true,
        rowCount: totalCount,
        getRowId: (row) => String(row.__row_index__ ?? row.__virtual_index__),
    });

    // ── Memoized getItemKey ─────────────────────────────────────────
    const getItemKey = useCallback((index: number) => index, []);

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
        findRowPosition(highlightId).then((pos) => {
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
            onRowClick(rowIndex != null ? String(rowIndex) : null);
        },
        [getRow, onRowClick],
    );

    // ── Render ──────────────────────────────────────────────────────
    const headerGroups = tableInstance.getHeaderGroups();

    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-[#141829] font-mono text-[#e2e8f0] text-xs">
            {/* Status bar */}
            <div className="flex shrink-0 items-center justify-between border-[#242a45] border-b px-3 py-1.5 font-sans text-[#8892b0] text-[11px]">
                <span>{loading ? "Loading…" : `${totalCount.toLocaleString()} observations`}</span>
            </div>

            {/* Scrollable container */}
            <div ref={containerRef} className="flex-1 overflow-auto">
                {/* Sticky header via TanStack Table header groups */}
                <div
                    className="sticky top-0 z-10 border-[#242a45] border-b bg-[#0c1021]"
                    style={{ height: HEADER_HEIGHT }}
                >
                    {headerGroups.map((headerGroup) => (
                        <div key={headerGroup.id} className="flex">
                            {headerGroup.headers.map((header) => (
                                <button
                                    type="button"
                                    key={header.id}
                                    className="flex shrink-0 cursor-pointer select-none items-center px-2 font-medium font-sans text-[#8892b0] text-[11px] hover:text-[#e2e8f0]"
                                    style={{ width: header.getSize(), height: HEADER_HEIGHT }}
                                    onClick={header.column.getToggleSortingHandler()}
                                >
                                    {header.isPlaceholder
                                        ? null
                                        : flexRender(header.column.columnDef.header, header.getContext())}
                                    {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? null}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>

                {/* Virtual row container */}
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: "100%",
                        position: "relative",
                    }}
                >
                    {virtualItems.map((virtualRow) => {
                        const row = getRow(virtualRow.index);
                        const isHighlighted =
                            highlightId != null &&
                            row?.__row_index__ != null &&
                            String(row.__row_index__) === highlightId;

                        return (
                            <button
                                type="button"
                                key={virtualRow.key}
                                data-index={virtualRow.index}
                                className={`absolute flex w-full cursor-pointer border-[#242a45]/50 border-b text-left ${
                                    isHighlighted ? "bg-[#242a45]" : "hover:bg-[#1a1f36]"
                                }`}
                                style={{
                                    height: `${ROW_HEIGHT}px`,
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
                                                      <span className="text-[#4a5278]">—</span>
                                                  ) : typeof val === "number" ? (
                                                      <span className="tabular-nums">
                                                          {Number.isInteger(val)
                                                              ? val.toLocaleString()
                                                              : val.toFixed(3)}
                                                      </span>
                                                  ) : (
                                                      <span className="truncate" title={String(val)}>
                                                          {String(val)}
                                                      </span>
                                                  )}
                                              </div>
                                          );
                                      })
                                    : /* Skeleton row */
                                      tableInstance
                                          .getAllColumns()
                                          .map((col) => (
                                              <div
                                                  key={col.id}
                                                  className="flex shrink-0 items-center px-2"
                                                  style={{ width: col.getSize(), height: ROW_HEIGHT }}
                                              >
                                                  <div className="h-3 w-2/3 animate-pulse rounded bg-[#242a45]" />
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
