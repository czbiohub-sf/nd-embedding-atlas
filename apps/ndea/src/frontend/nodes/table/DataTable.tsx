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
  type OnChangeFn,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { type RowIndex, rowIndex } from "@ndea/sdk";
import { CheckIcon, Columns3Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Bracketed } from "@/components/ui/bracketed";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type ColumnType, useColumnTypes } from "@/hooks/useColumnTypes";
import { type Row, type SortState, useTableQuery } from "./useTableQuery";

/** Typed-column glyph for the header (# numeric · ◇ categorical/text · · other). */
const TYPE_GLYPH: Record<ColumnType, string> = { number: "#", string: "◇", boolean: "⊙", other: "·" };

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
    const str = typeof val === "number" ? (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(3)) : String(val);
    maxLen = Math.max(maxLen, str.length);
  }
  return Math.min(MAX, Math.max(MIN, Math.ceil(maxLen * CHAR_WIDTH + PADDING)));
}

export interface DataTableProps {
  coordinator: Coordinator;
  table: string;
  columns: string[];
  selection?: Selection;
  focusedRowIndex?: RowIndex | null;
  onRowClick?: (rowIndex: RowIndex | null) => void;
  onTotalCountChange?: (n: number) => void;
  /** Controlled sort (the `ordering` coordination bridge). Omitted → DataTable
   *  owns its sort internally (uncontrolled, today's behavior). */
  sorting?: SortingState;
  onSortingChange?: (next: SortingState) => void;
  /** Workspace node/tile header slot: the column controls portal here (like the
   *  scatter toolbar). Absent → a docked control row renders inline instead. */
  headerEl?: HTMLElement | null;
}

export function DataTable({
  coordinator,
  table,
  columns: columnNames,
  selection,
  focusedRowIndex,
  onRowClick,
  onTotalCountChange,
  sorting: controlledSorting,
  onSortingChange,
  headerEl,
}: DataTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Server-side sort state (lifted into TanStack Table) ─────────
  // Controlled when the wrapper bridges sort to the `ordering` coordination
  // scope; otherwise internal. Either way a change re-renders + re-queries.
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const sorting = controlledSorting ?? internalSorting;
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    if (controlledSorting === undefined) setInternalSorting(next);
    onSortingChange?.(next);
  };
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [colFilter, setColFilter] = useState("");
  const autoSizedRef = useRef(false);

  // Column types (# / ◇ header glyphs) via `DESCRIBE dataset`.
  const colTypes = useColumnTypes(coordinator);

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
          if (val == null) return <span className="text-muted-foreground">:</span>;
          if (typeof val === "number") {
            return (
              <span className="tabular-nums">{Number.isInteger(val) ? val.toLocaleString() : val.toFixed(3)}</span>
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
  // Only includes rows that are actually loaded: NOT the full dataset.
  // TanStack Table sees this small array; Virtual handles the full count.
  const visibleData = useMemo(() => getCachedRows(), [getCachedRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent when row count changes so TerminalTable header can show it
  useEffect(() => {
    onTotalCountChange?.(totalCount);
  }, [totalCount, onTotalCountChange]);

  // Reset auto-sizing when the column SET changes (annotations add columns at
  // runtime). Keyed on columnNames and placed BEFORE the sizing effect so a new
  // column clears the latch first, then the sizing effect re-fits it.
  useEffect(() => {
    autoSizedRef.current = false;
  }, [columnNames]);

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

  // ── TanStack Table instance ─────────────────────────────────────
  const tableInstance = useReactTable({
    data: visibleData,
    columns: tableColumns,
    state: { sorting, columnSizing, columnVisibility },
    onSortingChange: handleSortingChange,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
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

  // ── Scroll-to-focus ─────────────────────────────────────────────
  useEffect(() => {
    if (focusedRowIndex == null) return;
    void findRowPosition(focusedRowIndex).then((pos) => {
      if (pos != null) {
        rowVirtualizer.scrollToIndex(pos, { align: "center" });
        ensureRange(Math.max(0, pos - 50), pos + 50);
      }
    });
  }, [focusedRowIndex, findRowPosition, rowVirtualizer, ensureRange]);

  // ── Row click handler ───────────────────────────────────────────
  const handleRowClick = useCallback(
    (virtualIndex: number) => {
      const row = getRow(virtualIndex);
      if (!row || !onRowClick) return;
      const rawRowIndex = row.__row_index__;
      onRowClick(rawRowIndex != null ? rowIndex(Number(rawRowIndex)) : null);
    },
    [getRow, onRowClick],
  );

  // ── Render ──────────────────────────────────────────────────────
  const headerGroups = tableInstance.getHeaderGroups();
  const totalWidth = tableInstance.getTotalSize();

  // "Best width when opened": size the Columns popover to the longest column name
  // (mono ~7px/char + chrome), clamped 224–384px: so names show without truncating
  // or forcing a horizontal scrollbar; anything past the cap truncates (title shows full).
  const popoverWidth = Math.min(384, Math.max(224, columnNames.reduce((m, n) => Math.max(m, n.length), 8) * 7 + 56));

  // Header controls: count + column view-options. Portaled into the node/tile
  // header slot (like the scatter toolbar); a docked row is the no-header fallback.
  const controls = (
    <div className="flex items-center gap-1.5 text-2xs" data-nodrag="1">
      <span className="text-muted-foreground">
        <Bracketed>{totalCount.toLocaleString()}</Bracketed>
      </span>
      <Popover>
        <PopoverTrigger
          aria-label="Columns"
          className="focus-ring inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Columns3Icon className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="end" style={{ width: popoverWidth }} className="gap-1.5 p-1.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="font-medium text-2xs text-muted-foreground">Columns</span>
            <span className="text-3xs text-text-muted tabular-nums">
              {tableInstance.getVisibleLeafColumns().length}/{tableInstance.getAllLeafColumns().length}
            </span>
          </div>
          <input
            value={colFilter}
            onChange={(e) => setColFilter(e.currentTarget.value)}
            placeholder="filter columns…"
            className="focus-ring h-6 w-full rounded border border-border bg-muted px-2 text-2xs text-foreground placeholder:text-text-muted"
          />
          <ScrollArea viewportClassName="max-h-72 overflow-x-hidden" contentClassName="min-w-0">
            {/* pr clears the overlay scrollbar's lane so long names don't tuck under it */}
            <div className="flex flex-col pr-2.5">
              {tableInstance
                .getAllLeafColumns()
                .filter((col) => col.id.toLowerCase().includes(colFilter.toLowerCase()))
                .map((col) => {
                  const on = col.getIsVisible();
                  return (
                    <button
                      key={col.id}
                      type="button"
                      title={col.id}
                      onClick={() => col.toggleVisibility()}
                      className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-2xs hover:bg-muted"
                    >
                      <span className="flex size-3.5 shrink-0 items-center justify-center text-primary">
                        {on ? <CheckIcon className="size-3" /> : null}
                      </span>
                      <span className={cn("min-w-0 truncate", on ? "text-foreground" : "text-text-muted")}>
                        {col.id}
                      </span>
                    </button>
                  );
                })}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-card font-mono text-foreground text-xs">
      {headerEl ? (
        createPortal(controls, headerEl)
      ) : (
        <div className="flex h-7 shrink-0 items-center justify-end border-border-subtle border-b px-2.5">
          {controls}
        </div>
      )}
      {/* Scrollable container */}
      <div ref={containerRef} className="flex-1 overflow-auto">
        {/* Sticky header via TanStack Table header groups */}
        <div
          className="sticky top-0 z-10 border-border border-b bg-background"
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
                    className="flex h-full w-full cursor-pointer select-none items-center gap-1 px-2 font-medium font-mono text-2xs text-muted-foreground outline-none focus-ring hover:text-foreground"
                    onClick={header.column.getToggleSortingHandler()}
                    title={header.isPlaceholder ? undefined : String(header.column.columnDef.header ?? header.id)}
                  >
                    {header.isPlaceholder ? null : (
                      <>
                        <span className="shrink-0 text-[9px] text-text-muted/70 tabular-nums">
                          {TYPE_GLYPH[colTypes?.get(header.column.id) ?? "other"]}
                        </span>
                        <span className="min-w-0 truncate">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                      </>
                    )}
                    {{ asc: "↑", desc: "↓" }[header.column.getIsSorted() as string] ? (
                      <span className="shrink-0 text-muted-foreground">
                        {{ asc: "↑", desc: "↓" }[header.column.getIsSorted() as string]}
                      </span>
                    ) : null}
                  </button>
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: column resize handle is drag-only */}
                  <div
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    onDoubleClick={() => handleAutoSizeColumn(header.column.id)}
                    className={`absolute top-0 right-0 h-full w-[3px] cursor-col-resize touch-none select-none ${
                      header.column.getIsResizing() ? "bg-primary" : "bg-transparent group-hover:bg-muted"
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
              focusedRowIndex != null && row?.__row_index__ != null && Number(row.__row_index__) === focusedRowIndex;

            return (
              <button
                type="button"
                key={virtualRow.key}
                data-index={virtualRow.index}
                className={`absolute flex cursor-pointer border-border/50 border-b text-left ${
                  isHighlighted ? "bg-muted" : "hover:bg-muted"
                }`}
                style={{
                  height: `${ROW_HEIGHT}px`,
                  minWidth: totalWidth,
                  transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                }}
                onClick={() => handleRowClick(virtualRow.index)}
              >
                {row
                  ? tableInstance.getVisibleLeafColumns().map((col) => {
                      const val = row[col.id];
                      return (
                        <div
                          key={col.id}
                          className="flex shrink-0 items-center overflow-hidden px-2"
                          style={{
                            width: col.getSize(),
                            height: ROW_HEIGHT,
                          }}
                        >
                          {val == null ? (
                            <span className="text-muted-foreground">:</span>
                          ) : typeof val === "number" ? (
                            <span className="tabular-nums">
                              {Number.isInteger(val) ? val.toLocaleString() : val.toFixed(3)}
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
                    tableInstance.getVisibleLeafColumns().map((col) => (
                      <div
                        key={col.id}
                        className="flex shrink-0 items-center px-2"
                        style={{ width: col.getSize(), height: ROW_HEIGHT }}
                      >
                        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
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
