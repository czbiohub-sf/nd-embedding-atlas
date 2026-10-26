/** Grid layout: crops wrap in reading order; each group is a collapsible section. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "../query/use-virtualizer";
import { GroupLayout, hasBit, type TableItem } from "../table/fields";
import { GroupHeader } from "../table/GroupHeader";
import type { ObsView } from "../table/useObsView";
import { captionHeight, type CropStyle, CropTile, TilePlaceholder } from "./CropTile";

const GAP = 8;
const HEADER = 28;

/** The content-box width of `ref`'s element, kept current. */
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function CropGrid({
  view,
  style,
  colorOf,
}: {
  view: ObsView;
  style: CropStyle;
  colorOf: (data: Record<string, unknown>) => string | null;
}) {
  const { query, collapsed, selection } = view;
  const scrollRef = useRef<HTMLDivElement>(null);
  const width = useWidth(scrollRef);
  const perLine = Math.max(1, Math.floor((width + GAP) / (style.size + GAP)));
  const count = query.count ?? 0;
  const layout = useMemo(
    () => (view.groupBy.length && query.groups ? new GroupLayout(query.groups, collapsed, perLine) : null),
    [view.groupBy.length, query.groups, collapsed, perLine],
  );
  const length = layout ? layout.length : Math.ceil(count / perLine);
  const item = useCallback(
    (index: number): TableItem =>
      layout
        ? layout.item(index)
        : { kind: "row", position: index * perLine, count: Math.min(perLine, count - index * perLine), group: null },
    [layout, perLine, count],
  );
  const lineHeight = style.size + captionHeight(style.fields, style.caption) + GAP;

  const { virtualItems, totalSize, scrollToIndex } = useVirtualizer({
    count: length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (item(i).kind === "group" ? HEADER : lineHeight),
    // Keys change with the line geometry, so the virtualizer drops its cached sizes.
    getItemKey: useCallback((i: number) => `${lineHeight}:${perLine}:${i}`, [lineHeight, perLine]),
    overscan: 3,
    paddingStart: GAP,
  });

  const first = virtualItems[0]?.index ?? 0;
  const last = virtualItems.at(-1)?.index ?? -1;
  const { ensureRange } = query;
  useEffect(() => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = -1;
    for (let i = first; i <= last && i < length; i++) {
      const it = item(i);
      if (it.kind === "row") {
        lo = Math.min(lo, it.position);
        hi = it.position + it.count - 1;
      }
    }
    if (hi >= 0) ensureRange(lo, hi);
  }, [first, last, length, item, ensureRange]);

  // Each focus request from elsewhere scrolls once.
  const revealed = useRef<object | null>(null);
  const { reveal } = view;
  useEffect(() => {
    if (!reveal || reveal === revealed.current || !width) return;
    const index = layout ? layout.indexOf(reveal.position) : Math.floor(reveal.position / perLine);
    if (index >= length) return;
    revealed.current = reveal;
    scrollToIndex(index, { align: "auto" });
  }, [reveal, layout, perLine, length, width, scrollToIndex]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2">
      <div style={{ height: totalSize, position: "relative" }}>
        {virtualItems.map((virtual) => {
          const it = item(virtual.index);
          const top = { transform: `translateY(${virtual.start}px)` };
          if (it.kind === "group")
            return (
              <GroupHeader
                key={virtual.key}
                item={it}
                field={view.groupBy[it.level]}
                onToggle={view.toggleGroup}
                className="w-full text-ui"
                style={{ ...top, height: HEADER }}
              />
            );
          return (
            <div key={virtual.key} className="absolute top-0 left-0 flex" style={{ ...top, gap: GAP }}>
              {Array.from({ length: it.count }, (_, k) => {
                const position = it.position + k;
                const data = query.getRow(position);
                if (!data) return <TilePlaceholder key={position} size={style.size} height={lineHeight - GAP} />;
                const row = Number(data.__row_index__);
                return (
                  <CropTile
                    key={row}
                    row={row}
                    data={data}
                    style={style}
                    color={colorOf(data)}
                    focused={row === view.focused}
                    selected={selection !== null && hasBit(selection, row)}
                    onClick={(e) => view.clickRow(position, row, e)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
