/**
 * Strips layout: each innermost group (a track, grouped by its id fields) is
 * one line under headers for the outer levels (dataset, FOV). Its crops run
 * left to right in sort order, or, with columns by a field, under one shared
 * column per value of that field (a pivot: by `t`, a column is one timepoint
 * in every strip).
 */

import type { Coordinator } from "@uwdata/mosaic-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { quoteIdent } from "@ndea/protocol";
import { toRows } from "../query/mosaic";
import { useVirtualizer } from "../query/use-virtualizer";
import { formatValue, type GroupValue, groupLabel, GroupLayout, hasBit, type TableItem } from "../table/fields";
import { GroupHeader, LEVEL_INDENT } from "../table/GroupHeader";
import type { ObsView } from "../table/useObsView";
import type { Row } from "../table/useTableQuery";
import { captionHeight, type CropStyle, CropTile } from "./CropTile";

const GAP = 8;
const LABEL = 176;
const HEADER = 24;
const GROUP_HEADER = 28;
// ponytail: columns by a field show at most this many values; page them if a field has more.
const MAX_COLUMNS = 2000;

const valueKey = (v: unknown) => JSON.stringify(v ?? null);

/** The distinct values of `columnsBy` among the shown obs, in order: the shared columns. */
function useColumnValues(coordinator: Coordinator, table: string, columnsBy: string | null, where: string | null) {
  const [values, setValues] = useState<{ key: string; values: GroupValue[] } | null>(null);
  const key = `${columnsBy}\n${where}`;
  useEffect(() => {
    if (!columnsBy) return;
    let live = true;
    const q = quoteIdent(columnsBy);
    void coordinator
      .query(
        `SELECT DISTINCT ${q} AS v FROM ${table}${where ? ` WHERE ${where}` : ""} ORDER BY 1 NULLS LAST LIMIT ${MAX_COLUMNS}`,
        { cache: false },
      )
      .then((rows) => live && setValues({ key, values: toRows(rows).map((r) => (r.v ?? null) as GroupValue) }));
    return () => {
      live = false;
    };
  }, [coordinator, table, columnsBy, where, key]);
  return columnsBy && values?.key === key ? values.values : null;
}

type Strip = Extract<TableItem, { kind: "row" }>;

export function CropStrips({
  view,
  style,
  colorOf,
  columnsBy,
  coordinator,
  table,
}: {
  view: ObsView;
  style: CropStyle;
  colorOf: (data: Row) => string | null;
  /** One shared column per value of this field; null runs each strip in sort order. */
  columnsBy: string | null;
  coordinator: Coordinator;
  table: string;
}) {
  const { query, selection, collapsed } = view;
  const layout = useMemo(
    () => (query.groups ? new GroupLayout(query.groups, collapsed, Infinity) : null),
    [query.groups, collapsed],
  );
  const length = layout?.length ?? 0;
  const columnValues = useColumnValues(coordinator, table, columnsBy, view.where);
  const columnOf = useMemo(() => new Map((columnValues ?? []).map((v, i) => [valueKey(v), i])), [columnValues]);
  const byValue = columnsBy !== null;
  const nColumns = byValue
    ? (columnValues?.length ?? 0)
    : (query.groups ?? []).reduce((n, g) => Math.max(n, g.count), 0);
  const depth = view.groupBy.length;
  // Strips sit under their outer headers' indent.
  const label = LABEL + Math.max(0, depth - 1) * LEVEL_INDENT;

  const scrollRef = useRef<HTMLDivElement>(null);
  const pitch = style.size + GAP;
  const lineHeight = style.size + captionHeight(style.fields, style.caption) + GAP;
  const top = byValue ? HEADER : GAP;
  const lines = useVirtualizer({
    count: length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (layout?.item(i).kind === "group" ? GROUP_HEADER : lineHeight),
    getItemKey: useCallback((i: number) => `${lineHeight}:${i}`, [lineHeight]),
    overscan: 3,
    scrollMargin: top,
    // Scrolled-to lines land below the sticky column header.
    scrollPaddingStart: top,
  });
  const columns = useVirtualizer({
    horizontal: true,
    count: nColumns,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => pitch,
    getItemKey: useCallback((i: number) => `${pitch}:${i}`, [pitch]),
    overscan: 2,
    scrollMargin: label,
    // Scrolled-to columns land right of the sticky strip labels.
    scrollPaddingStart: label,
  });
  const width = label + nColumns * pitch;

  // Strips in sort order load only their visible columns; by-value strips load whole (a cell's column is in its row).
  const firstLine = lines.virtualItems[0]?.index ?? 0;
  const lastLine = lines.virtualItems.at(-1)?.index ?? -1;
  const firstColumn = columns.virtualItems[0]?.index ?? 0;
  const lastColumn = columns.virtualItems.at(-1)?.index ?? -1;
  const { ensureRange } = query;
  useEffect(() => {
    if (!layout) return;
    for (let i = firstLine; i <= lastLine && i < layout.length; i++) {
      const it = layout.item(i);
      if (it.kind !== "row") continue;
      if (byValue) ensureRange(it.position, it.position + it.count - 1);
      else if (firstColumn < it.count)
        ensureRange(it.position + firstColumn, it.position + Math.min(lastColumn, it.count - 1));
    }
  }, [layout, firstLine, lastLine, firstColumn, lastColumn, byValue, ensureRange]);

  // Each focus request from elsewhere scrolls once: to its strip, then to its column once that is known
  // (a by-value strip's rows load after the strip scrolls into view).
  const revealed = useRef<object | null>(null);
  const pending = useRef<number | null>(null);
  const { reveal } = view;
  const scrollToLine = lines.scrollToIndex;
  const scrollToColumn = columns.scrollToIndex;
  useEffect(() => {
    if (!layout) return;
    if (reveal && reveal !== revealed.current) {
      revealed.current = reveal;
      scrollToLine(layout.indexOf(reveal.position), { align: "auto" });
      pending.current = reveal.position;
    }
    const position = pending.current;
    if (position === null) return;
    let column: number | undefined;
    if (byValue) {
      const data = query.getRow(position);
      if (!data || columnOf.size === 0) return;
      column = columnOf.get(valueKey(data[columnsBy]));
    } else {
      const it = layout.item(layout.indexOf(position));
      column = it.kind === "row" ? position - it.position : undefined;
    }
    pending.current = null;
    if (column !== undefined) scrollToColumn(column, { align: "center" });
  }, [layout, reveal, byValue, columnsBy, columnOf, query, scrollToLine, scrollToColumn]);

  // By value, most columns of a strip are empty (a track spans a few of many timepoints). When the columns or
  // groups change, scroll sideways once to the first column a visible strip fills, so the view opens on crops.
  const anchored = useRef<string | null>(null);
  const anchorKey = `${columnsBy}\n${view.groupBy.join("\u0000")}\n${view.where}`;
  useEffect(() => {
    if (!layout || !byValue || anchored.current === anchorKey || columnOf.size === 0) return;
    let first = Infinity;
    for (let i = firstLine; i <= lastLine && i < layout.length; i++) {
      const it = layout.item(i);
      if (it.kind !== "row") continue;
      for (let p = it.position; p < it.position + it.count; p++) {
        const data = query.getRow(p);
        const column = data && columnOf.get(valueKey(data[columnsBy]));
        if (column !== undefined) first = Math.min(first, column);
      }
    }
    if (first === Infinity) return;
    anchored.current = anchorKey;
    if (pending.current === null) scrollToColumn(first, { align: "start" });
  }, [layout, byValue, anchorKey, columnOf, firstLine, lastLine, columnsBy, query, scrollToColumn]);

  if (depth === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-text-muted">
        Strips put each group on one line. Under Group, pick the fields that name a strip: for one strip per track,
        group by fov_name, then by track_id.
      </div>
    );

  const strip = (it: Strip) => {
    // By value: the loaded obs of this strip by column; the first in each cell shows, the rest count.
    const cells = new Map<number, { position: number; data: Row; more: number }>();
    if (byValue)
      for (let p = it.position; p < it.position + it.count; p++) {
        const data = query.getRow(p);
        const column = data && columnOf.get(valueKey(data[columnsBy]));
        if (column === undefined || !data) continue;
        const cell = cells.get(column);
        if (cell) cell.more += 1;
        else cells.set(column, { position: p, data, more: 0 });
      }
    return columns.virtualItems.map((c) => {
      const position = it.position + c.index;
      const cell = byValue
        ? cells.get(c.index)
        : c.index < it.count
          ? { position, data: query.getRow(position), more: 0 }
          : undefined;
      if (!cell) return null;
      if (!cell.data)
        return (
          <span
            key={c.key}
            className="absolute top-0 animate-pulse rounded-[3px] bg-muted/20"
            style={{ left: c.start, width: style.size, height: style.size }}
          />
        );
      const { data } = cell;
      const row = Number(data.__row_index__);
      return (
        <div key={c.key} className="absolute top-0" style={{ left: c.start }}>
          <CropTile
            row={row}
            data={data}
            style={style}
            color={colorOf(data)}
            focused={row === view.focused}
            selected={selection !== null && hasBit(selection, row)}
            extra={cell.more}
            onClick={(e) => view.clickRow(cell.position, row, e)}
          />
        </div>
      );
    });
  };

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      {byValue ? (
        <div className="sticky top-0 z-10 bg-surface" style={{ height: HEADER, width }}>
          <span
            className="sticky left-0 flex h-full items-center bg-surface px-2 font-mono text-2xs text-text-muted"
            style={{ width: label }}
          >
            {columnsBy}
          </span>
          {columns.virtualItems.map((c) => (
            <span
              key={c.key}
              className="absolute top-0 flex h-full items-center justify-center font-mono text-2xs text-text-muted"
              style={{ left: c.start, width: style.size }}
            >
              {formatValue(columnValues?.[c.index]) || "empty"}
            </span>
          ))}
        </div>
      ) : null}
      <div style={{ height: lines.totalSize - top + GAP, width, position: "relative" }}>
        {layout &&
          lines.virtualItems.map((line) => {
            const it = layout.item(line.index);
            const at = { transform: `translateY(${line.start - top}px)` };
            if (it.kind === "group")
              return (
                <GroupHeader
                  key={line.key}
                  item={it}
                  field={view.groupBy[it.level]}
                  onToggle={view.toggleGroup}
                  className="text-ui"
                  style={{ ...at, height: GROUP_HEADER, width }}
                />
              );
            const name = it.group?.values.slice(-1) ?? [];
            return (
              <div key={line.key} className="absolute top-0 left-0" style={{ ...at, height: lineHeight, width }}>
                <div
                  className="sticky left-0 z-[1] flex h-full flex-col justify-center gap-0.5 bg-surface pr-2"
                  style={{ width: label, paddingBottom: GAP, paddingLeft: 8 + (depth - 1) * LEVEL_INDENT }}
                  title={it.group ? groupLabel(it.group.values) : undefined}
                >
                  <span className="font-mono text-2xs text-text-muted">{view.groupBy[depth - 1]}</span>
                  <span className="truncate font-medium text-ui">{groupLabel(name)}</span>
                  <span className="font-mono text-2xs text-text-muted">{it.count.toLocaleString("en-US")} obs</span>
                </div>
                {strip(it)}
              </div>
            );
          })}
      </div>
    </div>
  );
}
