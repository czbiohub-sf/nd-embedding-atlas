/**
 * AnnotateTable — a virtualized labeling table over the scoped obs.
 *
 * Reuses the Table node's server-side paged query (`useTableQuery`), so it
 * inherits scope (the wired predicate via the Mosaic `Selection`), paging, and
 * LRU page cache for free — and scopes correctly off a Filter/Wrangle edge,
 * unlike the old `predicateToSql` gate.
 *
 * Owns the SPREADSHEET selection model + keyboard, and reports up:
 *  - onChange({ selectedIds, focusId }) — selection mirror (rail + viewers)
 *  - onStamp(value)                     — a label key was pressed; stamp the
 *                                         current selection (view does the write)
 *  - onSkip()                           — advance without writing
 *
 * Stamped values are reflected through `localLabels` (an overlay the view owns)
 * so a write shows instantly without invalidating the page cache.
 */

import { useQueryClient } from "@tanstack/react-query";
import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChannelHash } from "@/lib/branded-types";
import { cn } from "@/lib/utils";
import { CropThumb } from "@/nodes/annotate/CropThumb";
import type { ChannelDef } from "@/nodes/image-viewer/viewer/ViewerContext";
import { obsCoordKey } from "@/nodes/table/useGalleryCropQuery";
import { type Row, useTableQuery } from "@/nodes/table/useTableQuery";

const ROW_HEIGHT = 28;
const THUMB_ROW_HEIGHT = 40;
const THUMB = 34;
const HEADER_HEIGHT = 24;
const OVERSCAN = 12;

/** Columns that locate a crop for an obs (from obs_base), resolved by the view. */
export interface CropFields {
  fov: string;
  t: string;
  dataset?: string;
  /** Coordinate columns — when present, coords seed the crop cache (no /api/obs). */
  x?: string;
  y?: string;
}
export interface FocusCrop {
  fovName: string;
  t: number | null;
  rowIndex: number;
  datasetKey?: string;
}

/** Render a DuckDB cell value as text (scalars direct; objects as JSON). */
function cellText(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return JSON.stringify(v);
}

export interface AnnotateTableProps {
  coordinator: Coordinator;
  table: string;
  /** Scope — the wired predicate. Rows + count narrow to this. */
  selection?: Selection;
  /** Context columns shown left of the label (e.g. the column being judged). */
  contextColumns: string[];
  /** The annotation column whose value each row shows (or null if none yet). */
  labelColumn: string | null;
  /** Locally-stamped values, keyed by obs id → column → value — overlays the queried cell.
   *  Per-column so range mode can reflect BOTH `{m}_min` and `{m}_max` at once. */
  localLabels: Map<string, Map<string, string>>;
  /** Label hotkeys (index-aligned with `labels`). */
  labels: string[];
  hotkeys: string[];
  /** Render the label column as a plain numeric (range mode) rather than a
   *  categorical pill — so a float `{m}_max` matches its `{m}_min` sibling. */
  numericLabel?: boolean;
  /** Gallery crops: a leading thumbnail per row when set + channels present. */
  cropFields: CropFields | null;
  channels: readonly ChannelDef[];
  hash: ChannelHash;
  onChange: (sel: { selectedIds: Set<string>; focusId: string | null; focusCrop: FocusCrop | null }) => void;
  onStamp: (value: string) => void;
  onSkip: () => void;
  onTotalCount: (n: number) => void;
  /** Follow an external focus (Gallery/Scatter/Idetik via host.highlight): jump the
   *  cursor to that obs. */
  externalFocusId?: string | null;
}

export function AnnotateTable({
  coordinator,
  table,
  selection,
  contextColumns,
  labelColumn,
  localLabels,
  labels,
  hotkeys,
  numericLabel,
  cropFields,
  channels,
  hash,
  onChange,
  onStamp,
  onSkip,
  onTotalCount,
  externalFocusId,
}: AnnotateTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const thumbs = cropFields != null && channels.length > 0;
  const rowH = thumbs ? THUMB_ROW_HEIGHT : ROW_HEIGHT;
  // Query carries obs id + context cols + the label col (so each row knows its
  // current value) + the crop-locator cols when thumbnails are on. Stable
  // identity so the cache isn't rebuilt every render.
  const columns = useMemo(() => {
    const c = [...contextColumns];
    if (labelColumn) c.push(labelColumn);
    if (cropFields) {
      c.push(cropFields.fov, cropFields.t);
      if (cropFields.dataset) c.push(cropFields.dataset);
      if (cropFields.x) c.push(cropFields.x);
      if (cropFields.y) c.push(cropFields.y);
    }
    return [...new Set(c)];
  }, [contextColumns, labelColumn, cropFields]);
  const { totalCount, getRow, ensureRange, findRowPosition } = useTableQuery({
    coordinator,
    table,
    columns,
    selection,
  });
  const queryClient = useQueryClient();

  // ── selection state (spreadsheet model) ─────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const anchorRef = useRef(0);

  const rowVirtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: OVERSCAN,
    scrollMargin: HEADER_HEIGHT,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  // load visible pages on scroll
  useEffect(() => {
    if (virtualItems.length === 0) return;
    ensureRange(virtualItems[0].index, virtualItems[virtualItems.length - 1].index);
  }, [virtualItems, ensureRange]);

  // Seed obs coords into the crop cache from the table query (coords already
  // arrive with each page) so CropThumb skips its per-row /api/obs fetch.
  useEffect(() => {
    const xc = cropFields?.x;
    const yc = cropFields?.y;
    if (!xc || !yc) return;
    for (const v of virtualItems) {
      const r = getRow(v.index);
      const ri = r?.__row_index__;
      if (!r || ri == null) continue;
      const x = r[xc];
      const y = r[yc];
      if (typeof x === "number" && typeof y === "number") {
        queryClient.setQueryData(obsCoordKey(Number(ri)), { x, y });
      }
    }
  }, [virtualItems, getRow, cropFields, queryClient]);

  useEffect(() => onTotalCount(totalCount), [totalCount, onTotalCount]);

  const idAt = useCallback(
    (index: number) => {
      const r = getRow(index);
      const ri = r?.__row_index__;
      return ri != null ? String(ri as number) : null;
    },
    [getRow],
  );

  const focusId = idAt(focusIndex);

  const focusCrop = useMemo<FocusCrop | null>(() => {
    if (!cropFields) return null;
    const r = getRow(focusIndex);
    const ri = r?.__row_index__;
    if (!r || ri == null) return null;
    const t = r[cropFields.t];
    return {
      fovName: typeof r[cropFields.fov] === "string" ? (r[cropFields.fov] as string) : "",
      t: typeof t === "number" ? t : null,
      rowIndex: Number(ri),
      datasetKey:
        cropFields.dataset && typeof r[cropFields.dataset] === "string" ? (r[cropFields.dataset] as string) : undefined,
    };
  }, [cropFields, getRow, focusIndex]);

  // emit selection mirror whenever it changes
  useEffect(() => {
    onChange({ selectedIds, focusId, focusCrop });
  }, [selectedIds, focusId, focusCrop, onChange]);

  // ids in an inclusive virtual-index range (loaded rows only)
  const idsInRange = useCallback(
    (a: number, b: number) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const ids = new Set<string>();
      for (let i = lo; i <= hi; i++) {
        const id = idAt(i);
        if (id != null) ids.add(id);
      }
      return ids;
    },
    [idAt],
  );

  const focusTo = useCallback(
    (index: number) => {
      const i = Math.max(0, Math.min(index, totalCount - 1));
      setFocusIndex(i);
      anchorRef.current = i;
      const id = idAt(i);
      setSelectedIds(id ? new Set([id]) : new Set());
      rowVirtualizer.scrollToIndex(i, { align: "auto" });
      ensureRange(Math.max(0, i - 25), i + 25);
    },
    [totalCount, idAt, rowVirtualizer, ensureRange],
  );

  // Follow an external focus (Gallery/Scatter/Idetik crop click → host.highlight):
  // resolve the obs's position in the current scope+sort, then jump the cursor
  // there. Guarded on focusId so our own emitted focus never loops back.
  useEffect(() => {
    if (externalFocusId == null || externalFocusId === focusId) return;
    let alive = true;
    void findRowPosition(externalFocusId).then((pos) => {
      if (alive && pos != null && pos >= 0) focusTo(pos);
    });
    return () => {
      alive = false;
    };
  }, [externalFocusId, focusId, findRowPosition, focusTo]);

  const onRowMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      const id = idAt(index);
      if (id == null) return;
      if (e.shiftKey) {
        setSelectedIds(idsInRange(anchorRef.current, index));
        setFocusIndex(index);
      } else if (e.metaKey || e.ctrlKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setFocusIndex(index);
        anchorRef.current = index;
      } else {
        setSelectedIds(new Set([id]));
        setFocusIndex(index);
        anchorRef.current = index;
      }
    },
    [idAt, idsInRange],
  );

  // keyboard: nav + range-extend + label keys + skip + clear
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const k = e.key;
      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        const next = focusIndex + (k === "ArrowDown" ? 1 : -1);
        const i = Math.max(0, Math.min(next, totalCount - 1));
        if (e.shiftKey) {
          setFocusIndex(i);
          setSelectedIds(idsInRange(anchorRef.current, i));
          rowVirtualizer.scrollToIndex(i, { align: "auto" });
          ensureRange(Math.max(0, i - 25), i + 25);
        } else {
          focusTo(i);
        }
        return;
      }
      if (k === " ") {
        e.preventDefault();
        onSkip();
        focusTo(focusIndex + 1);
        return;
      }
      if (k === "Escape") {
        e.preventDefault();
        const id = idAt(focusIndex);
        setSelectedIds(id ? new Set([id]) : new Set());
        anchorRef.current = focusIndex;
        return;
      }
      const idx = hotkeys.indexOf(k.toLowerCase());
      if (idx >= 0) {
        e.preventDefault();
        onStamp(labels[idx]);
        // single → advance; multi → collapse to focus (handled by parent re-stamp guard)
        if (selectedIds.size <= 1) focusTo(focusIndex + 1);
        else {
          const id = idAt(focusIndex);
          setSelectedIds(id ? new Set([id]) : new Set());
          anchorRef.current = focusIndex;
        }
      }
    },
    [
      focusIndex,
      totalCount,
      hotkeys,
      labels,
      selectedIds.size,
      idsInRange,
      focusTo,
      idAt,
      onStamp,
      onSkip,
      rowVirtualizer,
      ensureRange,
    ],
  );

  const gridCols = useMemo(
    () => `${thumbs ? `${THUMB}px ` : ""}96px ${contextColumns.map(() => "minmax(0,1fr)").join(" ")} 132px`,
    [contextColumns, thumbs],
  );

  const labelValue = (row: Row | undefined, id: string | null): string | null => {
    if (!labelColumn) return null;
    const overlay = id ? localLabels.get(id)?.get(labelColumn) : undefined;
    if (overlay != null) return overlay;
    return row ? ((row[labelColumn] as string | null) ?? null) : null;
  };

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="grid"
      aria-label="annotation rows — click to select, shift/⌘ to extend, label key to stamp"
      aria-rowcount={totalCount}
      className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
    >
      {/* sticky header */}
      <div
        role="row"
        className="sticky top-0 z-10 grid items-center border-border border-b bg-card px-2.5 text-3xs text-text-muted uppercase tracking-[0.5px]"
        style={{ gridTemplateColumns: gridCols, height: HEADER_HEIGHT }}
      >
        {thumbs && <span role="columnheader" aria-label="crop" />}
        <span role="columnheader">obs</span>
        {contextColumns.map((c) => (
          <span key={c} role="columnheader" className="truncate" title={c}>
            {c}
          </span>
        ))}
        <span role="columnheader">{labelColumn ?? "label"}</span>
      </div>

      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {virtualItems.map((v) => {
          const row = getRow(v.index);
          const id = idAt(v.index);
          const isSel = id != null && selectedIds.has(id);
          const isFocus = v.index === focusIndex;
          const val = labelValue(row, id);
          return (
            <div
              key={v.key}
              role="row"
              aria-rowindex={v.index + 2}
              aria-selected={isSel}
              aria-current={isFocus ? "true" : undefined}
              onMouseDown={(e) => onRowMouseDown(v.index, e)}
              className={cn(
                "absolute grid cursor-pointer items-center border-border-subtle border-b px-2.5 text-xs",
                isSel ? "bg-primary/12" : "hover:bg-foreground/4",
                isFocus && "shadow-[inset_0_0_0_1px_oklch(0.554_0.236_281_/_28%)]",
              )}
              style={{
                gridTemplateColumns: gridCols,
                height: rowH,
                width: "100%",
                transform: `translateY(${v.start - rowVirtualizer.options.scrollMargin}px)`,
              }}
            >
              {thumbs && (
                <span role="gridcell" className="flex items-center">
                  {row && cropFields && typeof row[cropFields.fov] === "string" ? (
                    <CropThumb
                      fovName={row[cropFields.fov] as string}
                      t={typeof row[cropFields.t] === "number" ? (row[cropFields.t] as number) : null}
                      rowIndex={Number(row.__row_index__)}
                      datasetKey={
                        cropFields.dataset && typeof row[cropFields.dataset] === "string"
                          ? (row[cropFields.dataset] as string)
                          : undefined
                      }
                      channels={channels}
                      hash={hash}
                      className="size-[30px]"
                    />
                  ) : (
                    <span className="size-[30px] rounded bg-muted/20" />
                  )}
                </span>
              )}
              <span role="gridcell" className="truncate text-text-muted tabular-nums">
                {id ?? "·"}
              </span>
              {contextColumns.map((c) => {
                // Overlay a locally-stamped cell (range mode's `{m}_min`) so it
                // reflects instantly, same as the label column.
                const text = (id ? localLabels.get(id)?.get(c) : undefined) ?? (row ? cellText(row[c]) : "");
                return (
                  <span key={c} role="gridcell" className="truncate text-muted-foreground tabular-nums" title={text}>
                    {text}
                  </span>
                );
              })}
              <span role="gridcell">
                {val == null ? (
                  <span className="text-text-muted">—</span>
                ) : numericLabel ? (
                  <span className="truncate text-muted-foreground tabular-nums">{val}</span>
                ) : (
                  <span className="rounded-full bg-primary/25 px-2 py-px text-2xs text-foreground">{val}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
