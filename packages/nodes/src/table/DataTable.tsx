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
  type ColumnVisibilityState,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  flexRender,
  type OnChangeFn,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Coordinator } from "@uwdata/mosaic-core";
import { type FilterCoordinationAPI, type RowIndex, rowIndex } from "@ndea/sdk";
import { CheckIcon, Columns3Icon, ChevronRightIcon, Rows3Icon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@ndea/ui/lib/utils";
import { Bracketed } from "@ndea/ui/components/bracketed";
import { Popover, PopoverContent, PopoverTrigger } from "@ndea/ui/components/popover";
import { ScrollArea } from "@ndea/ui/components/scroll-area";
import { type ColumnType, useColumnTypes } from "../query/useColumnTypes";
import { type Row, type SortState, useTableQuery } from "./useTableQuery";
import type { GroupKey } from "./grouped-rows";
import { useGroupedTableQuery } from "./useGroupedTableQuery";
import { useScrollRestore } from "./use-scroll-restore";

/** Typed-column glyph for the header (# numeric · ◇ categorical/text · · other). */
const TYPE_GLYPH: Record<ColumnType, string> = { number: "#", string: "◇", boolean: "⊙", other: "·" };

/** Sort-direction glyph for the header; unsorted columns have no entry. */
const SORT_GLYPH: Record<string, string> = { asc: "↑", desc: "↓" };

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 30;
const OVERSCAN = 15;
/**
 * Extra height a row takes while its detail panel is open. The panel grows the
 * row itself rather than occupying its own virtual slot: that keeps every flat
 * index addressing the same record, so detail expansion composes with grouping
 * without a second layer of index math.
 */
const DETAIL_HEIGHT = 148;
/**
 * Leading expander column. `__`-prefixed like the dataset's own internal
 * columns, so the Columns popover (which lists `columnNames`) never offers it
 * and no obs column can collide with it.
 */
const EXPANDER_COLUMN_ID = "__expander__";
const EXPANDER_WIDTH = 26;
const DATA_TABLE_FEATURES = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  columnResizingFeature,
});

function formatCellValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3);
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

/** Starting column width, replaced by the data-driven auto-fit once rows load. */
function initialColumnSize(name: string): number {
  if (name.length < 6) return 80;
  if (name.length < 12) return 120;
  return 160;
}

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
    maxLen = Math.max(maxLen, formatCellValue(val).length);
  }
  return Math.min(MAX, Math.max(MIN, Math.ceil(maxLen * CHAR_WIDTH + PADDING)));
}

export interface DataTableProps {
  coordinator: Coordinator;
  table: string;
  columns: string[];
  filter: FilterCoordinationAPI;
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
  /**
   * Column to group rows by, or null for a flat table. Grouping runs as a DuckDB
   * `GROUP BY` (see `useGroupedTableQuery`), never TanStack Table's client-side
   * grouped row model, which would only ever see the loaded pages.
   */
  groupBy?: string | null;
  onGroupByChange?: (column: string | null) => void;
  /**
   * Row media rendered at the left of the expanded row-detail panel — the
   * caller-supplied sub-component from the docs' pattern. The table owns the
   * record display (it has the columns); the node contributes the image, which
   * needs dataset services this component deliberately cannot reach.
   */
  renderRowMedia?: (row: Row) => ReactNode;
}

export function DataTable({
  coordinator,
  table,
  columns: columnNames,
  filter,
  focusedRowIndex,
  onRowClick,
  onTotalCountChange,
  sorting: controlledSorting,
  onSortingChange,
  headerEl,
  groupBy = null,
  onGroupByChange,
  renderRowMedia,
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
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});
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
    filter,
    sort,
  });

  // ── Grouped source ──────────────────────────────────────────────
  // Expansion is OUR state, not `rowExpandingFeature`. That feature drives
  // `table.getRowModel()`, and this table deliberately does not render from the
  // row model: it virtualizes over the server's total count and pulls rows from
  // its own page cache. Registering a client-side expanding/grouping feature here
  // would be inert at best and, for grouping, would silently describe one page as
  // the whole dataset. This is what the docs call manual grouping/expanding.
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<GroupKey>>(() => new Set());
  // Group keys are positional anchors; a new grouping column or filter invalidates
  // every one of them, so collapse rather than carry stale expansion across.
  useEffect(() => {
    setExpandedGroups(new Set());
  }, [groupBy]);

  const grouped = useGroupedTableQuery({
    coordinator,
    table,
    columns: columnNames,
    groupBy,
    expanded: expandedGroups,
    selection: filter.selection,
    sort,
  });
  const isGrouped = groupBy != null;

  const toggleGroup = useCallback((key: GroupKey) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Column definitions ──────────────────────────────────────────
  // A real leading column for the expander, per the docs' sub-components
  // example, rather than an affordance layered over the first data cell: it
  // occupies header width too, so cells stay aligned with the sticky header and
  // the column virtualizer measures it like any other column.
  const tableColumns = useMemo<ColumnDef<typeof DATA_TABLE_FEATURES, Row>[]>(
    () => [
      {
        id: EXPANDER_COLUMN_ID,
        header: "",
        size: EXPANDER_WIDTH,
        minSize: EXPANDER_WIDTH,
        maxSize: EXPANDER_WIDTH,
        enableResizing: false,
      },
      // The spread breaks the contextual typing the bare `.map` used to get from
      // the `useMemo` annotation, so the element type is named here.
      ...columnNames.map((name): ColumnDef<typeof DATA_TABLE_FEATURES, Row> => ({
        id: name,
        accessorFn: (row: Row) => row[name],
        header: name,
        size: initialColumnSize(name),
        minSize: 50,
        maxSize: 600,
        cell: (info) => {
          const val = info.getValue();
          if (val == null) return <span className="text-muted-foreground">:</span>;
          const text = formatCellValue(val);
          return (
            <span className={cn("truncate", typeof val === "number" && "tabular-nums")} title={text}>
              {text}
            </span>
          );
        },
      })),
    ],
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
  const tableInstance = useTable({
    features: DATA_TABLE_FEATURES,
    data: visibleData,
    columns: tableColumns,
    state: { sorting, columnSizing, columnVisibility },
    onSortingChange: handleSortingChange,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    manualSorting: true,
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
  // One virtualizer for both modes. Grouped, the count is headers plus the
  // children of expanded groups, which `grouped-rows` computes exactly from the
  // server's per-group COUNT — so the scrollbar is right before any child loads.
  const virtualRowCount = isGrouped ? grouped.totalCount : totalCount;
  // A single open detail at a time: this is row inspection, not a second
  // selection model. Keyed by flat index, so any structural change (grouping,
  // group expansion, sort, filter) invalidates it — see the reset below.
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: virtualRowCount,
    getScrollElement: () => containerRef.current,
    // Deliberately uniform, and deliberately NOT a function of `detailIndex`.
    // A varying `estimateSize` has to be applied with `measure()`, which clears
    // the whole size cache and recomputes every measurement: measured at 33ms
    // for ~174 grouped slots against 138ms for 3,596 flat rows, i.e. cost that
    // scales with the dataset for a one-row change. `resizeItem` below patches
    // the single entry and shifts the rest instead.
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey,
    scrollMargin: HEADER_HEIGHT,
  });

  // Apply the open row's extra height, and restore the one that just closed.
  const resizedRef = useRef<number | null>(null);
  useEffect(() => {
    const previous = resizedRef.current;
    if (previous != null && previous !== detailIndex) rowVirtualizer.resizeItem(previous, ROW_HEIGHT);
    if (detailIndex != null) rowVirtualizer.resizeItem(detailIndex, ROW_HEIGHT + DETAIL_HEIGHT);
    resizedRef.current = detailIndex;
  }, [detailIndex, rowVirtualizer]);

  // A flat index means a different record once the layout changes underneath it,
  // and `resizeItem` caches by index, so the stored height has to go with it or
  // an unrelated row inherits the open row's size.
  useEffect(() => {
    setDetailIndex(null);
    resizedRef.current = null;
    rowVirtualizer.measure();
  }, [groupBy, expandedGroups, sorting, rowVirtualizer]);

  // ── Column virtualization ───────────────────────────────────────
  // Spacer-cell strategy from the TanStack Virtual docs rather than absolutely
  // positioned cells: rows lay out with flex and the header is sticky, both of
  // which absolute positioning breaks. Two zero-content divs stand in for the
  // columns scrolled off either edge, so header/body/skeleton stay aligned.
  // The expander is pinned, so it is deliberately NOT virtualized: it renders
  // once per row as a sticky leading cell, outside the virtual run. Virtualizing
  // it would unmount the affordance as soon as column 0 scrolled out of range.
  const allVisibleColumns = tableInstance.getVisibleLeafColumns();
  const visibleColumns = useMemo(
    () => allVisibleColumns.filter((col) => col.id !== EXPANDER_COLUMN_ID),
    [allVisibleColumns],
  );
  const columnVirtualizer = useVirtualizer({
    count: visibleColumns.length,
    estimateSize: (index) => visibleColumns[index].getSize(),
    getScrollElement: () => containerRef.current,
    horizontal: true,
    overscan: 3,
  });
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const virtualPaddingLeft = virtualColumns[0]?.start ?? 0;
  const virtualPaddingRight = columnVirtualizer.getTotalSize() - (virtualColumns[virtualColumns.length - 1]?.end ?? 0);

  // `estimateSize` reads `column.getSize()`, so the measurement cache goes stale
  // whenever a column is dragged or double-click auto-fitted. Re-measure on every
  // sizing change (covers both the resize handle and the data-driven auto-fit).
  useEffect(() => {
    columnVirtualizer.measure();
  }, [columnSizing, columnVirtualizer]);

  // Body reparenting (Canvas socket ⇄ Stage tile) silently zeroes the container's
  // scroll offset, which both virtualizers read only from scroll events.
  useScrollRestore(containerRef);

  // ── Fetch visible pages on scroll ───────────────────────────────
  const virtualItems = rowVirtualizer.getVirtualItems();
  const ensureVisible = isGrouped ? grouped.ensureRange : ensureRange;
  useEffect(() => {
    if (virtualItems.length === 0) return;
    const start = virtualItems[0].index;
    const end = virtualItems[virtualItems.length - 1].index;
    ensureVisible(start, end);
  }, [virtualItems, ensureVisible]);

  // ── Scroll-to-focus ─────────────────────────────────────────────
  // Ungrouped only: `findRowPosition` returns an offset into the FLAT ordering,
  // which is not a grouped flat index (headers occupy slots, collapsed groups hide
  // their rows entirely). Scrolling to a focused obs while grouped needs a
  // group-aware lookup, so it is skipped rather than sent to the wrong row.
  useEffect(() => {
    if (focusedRowIndex == null || isGrouped) return;
    void findRowPosition(focusedRowIndex).then((pos) => {
      if (pos != null) {
        rowVirtualizer.scrollToIndex(pos, { align: "center" });
        ensureRange(Math.max(0, pos - 50), pos + 50);
      }
    });
  }, [focusedRowIndex, findRowPosition, rowVirtualizer, ensureRange, isGrouped]);

  // ── Row click handler ───────────────────────────────────────────
  // Takes the row, not a virtual index: in grouped mode the flat index addresses a
  // header-or-child slot, so `getRow(index)` from the ungrouped source would
  // resolve the wrong record.
  const handleRowSelect = useCallback(
    (row: Row | undefined) => {
      if (!row || !onRowClick) return;
      const rawRowIndex = row.__row_index__;
      onRowClick(rawRowIndex != null ? rowIndex(Number(rawRowIndex)) : null);
    },
    [onRowClick],
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
        <Bracketed>
          {isGrouped
            ? `${grouped.layout.groups.length.toLocaleString()}${grouped.truncated ? "+" : ""} groups`
            : totalCount.toLocaleString()}
        </Bracketed>
      </span>
      {onGroupByChange ? (
        <Popover>
          <PopoverTrigger
            aria-label="Group by"
            title={isGrouped ? `Grouped by ${groupBy}` : "Group by…"}
            className={cn(
              "focus-ring inline-flex size-5 items-center justify-center rounded transition-colors hover:bg-muted hover:text-foreground",
              isGrouped ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Rows3Icon className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent align="end" style={{ width: popoverWidth }} className="gap-1.5 p-1.5">
            <div className="flex items-center justify-between px-0.5">
              <span className="font-medium text-2xs text-muted-foreground">Group by</span>
              {isGrouped ? (
                <button
                  type="button"
                  onClick={() => onGroupByChange(null)}
                  className="rounded px-1 text-3xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  clear
                </button>
              ) : null}
            </div>
            {/* Grouping is a DuckDB GROUP BY, so a high-cardinality column would
                emit one header per row; the hook caps the list and reports it. */}
            {grouped.truncated ? (
              <span className="px-0.5 text-3xs text-warning">
                too many groups to list in full — showing the first {grouped.layout.groups.length.toLocaleString()}
              </span>
            ) : null}
            <ScrollArea viewportClassName="max-h-72 overflow-x-hidden" contentClassName="min-w-0">
              <div className="flex flex-col pr-2.5">
                {columnNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    onClick={() => onGroupByChange(name === groupBy ? null : name)}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-2xs hover:bg-muted"
                  >
                    <span className="flex size-3.5 shrink-0 items-center justify-center text-primary">
                      {name === groupBy ? <CheckIcon className="size-3" /> : null}
                    </span>
                    <span className={cn("min-w-0 truncate", name === groupBy ? "text-foreground" : "text-text-muted")}>
                      {name}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      ) : null}
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
    <div className="flex h-full w-full flex-col overflow-hidden bg-node-surface font-mono text-foreground text-xs">
      {headerEl ? (
        createPortal(controls, headerEl)
      ) : (
        <div className="flex h-7 shrink-0 items-center justify-end border-border-subtle border-b px-2.5">
          {controls}
        </div>
      )}
      {/* Scrollable container */}
      <div ref={containerRef} className="flex-1 overflow-auto">
        {/* Sticky header via TanStack Table header groups. Raised above the node
            body so rows scroll under it, matching the other sticky headers
            rather than borrowing the page colour. */}
        <div
          className="sticky top-0 z-10 border-border border-b bg-card"
          style={{ height: HEADER_HEIGHT, minWidth: totalWidth }}
        >
          {headerGroups.map((headerGroup) => {
            // Indices come from the virtualizer, which counts data columns only.
            const dataHeaders = headerGroup.headers.filter((h) => h.column.id !== EXPANDER_COLUMN_ID);
            return (
              <div key={headerGroup.id} className="flex" style={{ minWidth: totalWidth }}>
                {/* Pinned expander lane: sticky so it stays put under horizontal scroll. */}
                <div
                  className="sticky left-0 z-10 shrink-0 bg-card"
                  style={{ width: EXPANDER_WIDTH, height: HEADER_HEIGHT }}
                />
                <div className="shrink-0" style={{ width: virtualPaddingLeft }} />
                {virtualColumns.map((virtualColumn) => {
                  const header = dataHeaders[virtualColumn.index];
                  const sortGlyph = SORT_GLYPH[String(header.column.getIsSorted())];
                  return (
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
                        {sortGlyph ? <span className="shrink-0 text-muted-foreground">{sortGlyph}</span> : null}
                      </button>
                      {/* The expander column has a fixed width, so it offers no handle. */}
                      {header.column.getCanResize() ? (
                        // biome-ignore lint/a11y/noStaticElementInteractions: column resize handle is drag-only
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onDoubleClick={() => handleAutoSizeColumn(header.column.id)}
                          className={`absolute top-0 right-0 h-full w-[3px] cursor-col-resize touch-none select-none ${
                            header.column.getIsResizing() ? "bg-primary" : "bg-transparent group-hover:bg-muted"
                          }`}
                        />
                      ) : null}
                    </div>
                  );
                })}
                <div className="shrink-0" style={{ width: virtualPaddingRight }} />
              </div>
            );
          })}
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
            const slot = isGrouped ? grouped.getSlot(virtualRow.index) : undefined;
            // A grouped child's row may still be in flight; both modes fall through
            // to the same skeleton when the row is undefined.
            const row = isGrouped ? (slot?.kind === "child" ? slot.row : undefined) : getRow(virtualRow.index);
            const isHighlighted =
              focusedRowIndex != null && row?.__row_index__ != null && Number(row.__row_index__) === focusedRowIndex;
            const rowTransform = `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`;

            if (slot?.kind === "header") {
              const open = expandedGroups.has(slot.group.key);
              return (
                <button
                  type="button"
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  className="absolute flex cursor-pointer items-center gap-2 border-border/50 border-b bg-card/70 pr-2 text-left hover:bg-muted"
                  style={{ height: `${ROW_HEIGHT}px`, minWidth: totalWidth, transform: rowTransform }}
                  onClick={() => toggleGroup(slot.group.key)}
                  title={`${groupBy} = ${formatCellValue(slot.group.key)}`}
                >
                  {/* Same pinned lane as the rows, so both chevrons stay put and aligned. */}
                  <span
                    className="sticky left-0 z-[1] flex shrink-0 items-center justify-center bg-card"
                    style={{ width: EXPANDER_WIDTH }}
                  >
                    <ChevronRightIcon
                      className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-90")}
                    />
                  </span>
                  <span className="min-w-0 truncate font-medium">{formatCellValue(slot.group.key)}</span>
                  {/* Server-side COUNT(*) over the whole group, not the loaded page. */}
                  <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                    {slot.group.count.toLocaleString()}
                  </span>
                </button>
              );
            }

            const detailOpen = virtualRow.index === detailIndex;
            // Only the open row asks for media, so a table with nothing expanded
            // issues no crop requests at all.
            const media = detailOpen && row && renderRowMedia ? renderRowMedia(row) : null;
            return (
              <button
                type="button"
                key={virtualRow.key}
                data-index={virtualRow.index}
                className={cn(
                  "absolute flex cursor-pointer flex-col border-border/50 border-b text-left",
                  isHighlighted ? "bg-muted" : "hover:bg-muted",
                  // Children get a left accent rather than an indent: indenting would
                  // shift cells out of alignment with the sticky header, and column
                  // alignment matters more in a data table than nesting depth.
                  slot?.kind === "child" && "border-l-2 border-l-primary/30",
                )}
                style={{
                  height: `${detailOpen ? ROW_HEIGHT + DETAIL_HEIGHT : ROW_HEIGHT}px`,
                  minWidth: totalWidth,
                  transform: rowTransform,
                }}
                onClick={(event) => {
                  // One handler, no nested interactive element: the expander is a
                  // plain span, so the row stays a single focusable control and the
                  // markup stays valid.
                  if (event.target instanceof Element && event.target.closest(`[data-expander]`)) {
                    setDetailIndex((prev) => (prev === virtualRow.index ? null : virtualRow.index));
                    return;
                  }
                  handleRowSelect(row);
                }}
                // Keeps the whole row as a shortcut for the same toggle; single click
                // already means "focus this obs" across every wired view.
                onDoubleClick={() => setDetailIndex((prev) => (prev === virtualRow.index ? null : virtualRow.index))}
              >
                <div className="flex shrink-0" style={{ height: ROW_HEIGHT }}>
                  {row ? (
                    <>
                      {/* Pinned lane, outside the virtual run: `bg-inherit` keeps the
                          row's own hover/highlight tint showing through the sticky cell. */}
                      <div
                        data-expander
                        title={detailOpen ? "hide details" : "show every column"}
                        className="sticky left-0 z-[1] flex shrink-0 items-center justify-center bg-inherit text-muted-foreground hover:text-foreground"
                        style={{ width: EXPANDER_WIDTH, height: ROW_HEIGHT }}
                      >
                        <ChevronRightIcon className={cn("size-3 transition-transform", detailOpen && "rotate-90")} />
                      </div>
                      <div className="shrink-0" style={{ width: virtualPaddingLeft }} />
                      {virtualColumns.map((virtualColumn) => {
                        const col = visibleColumns[virtualColumn.index];
                        const val = row[col.id];
                        const text = val == null ? null : formatCellValue(val);
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
                            ) : (
                              <span
                                className={cn("truncate", typeof val === "number" && "tabular-nums")}
                                title={text ?? ""}
                              >
                                {text}
                              </span>
                            )}
                          </div>
                        );
                      })}
                      <div className="shrink-0" style={{ width: virtualPaddingRight }} />
                    </>
                  ) : (
                    /* Skeleton row */
                    <>
                      {/* Matches the loaded row's pinned lane so widths stay aligned. */}
                      <div className="sticky left-0 shrink-0 bg-inherit" style={{ width: EXPANDER_WIDTH }} />
                      <div className="shrink-0" style={{ width: virtualPaddingLeft }} />
                      {virtualColumns.map((virtualColumn) => {
                        const col = visibleColumns[virtualColumn.index];
                        return (
                          <div
                            key={col.id}
                            className="flex shrink-0 items-center px-2"
                            style={{ width: col.getSize(), height: ROW_HEIGHT }}
                          >
                            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                          </div>
                        );
                      })}
                      <div className="shrink-0" style={{ width: virtualPaddingRight }} />
                    </>
                  )}
                </div>
                {detailOpen && row ? (
                  // Sticky so the panel stays put while the columns scroll sideways:
                  // it describes the whole record, not the columns currently in view,
                  // and it shows the ones column virtualization never mounted.
                  <div
                    className="sticky left-0 flex min-h-0 gap-3 overflow-hidden border-border/50 border-t bg-node-surface px-2 py-1.5"
                    style={{ height: DETAIL_HEIGHT, width: 900 }}
                  >
                    {media ? <div className="aspect-square shrink-0">{media}</div> : null}
                    <div className="grid min-w-0 flex-1 grid-cols-3 content-start gap-x-4 gap-y-0.5">
                      {columnNames.map((name) => {
                        const val = row[name];
                        return (
                          <div key={name} className="flex min-w-0 items-baseline gap-1.5 text-2xs">
                            <span className="shrink-0 text-text-muted">{name}</span>
                            <span
                              className={cn("min-w-0 truncate", typeof val === "number" && "tabular-nums")}
                              title={val == null ? "" : formatCellValue(val)}
                            >
                              {val == null ? "·" : formatCellValue(val)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
