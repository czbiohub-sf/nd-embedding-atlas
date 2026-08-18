/**
 * Flat-index math for a server-side grouped table.
 *
 * TanStack Table's `createGroupedRowModel()` is CLIENT-side: it groups the rows the
 * browser happens to hold. Our table holds at most a few pages of a DuckDB-backed
 * dataset, so a client-side grouped model would group one page and present it as
 * groups over the whole dataset — plausible-looking, wrong numbers. The docs are
 * explicit about this and steer server-returned subsets to `manualGrouping`.
 *
 * So grouping happens in SQL, and this module owns the one piece SQL cannot: given
 * the ordered group keys with their server-side row counts, plus which groups are
 * expanded, map a virtual row index to either a group header or a specific child
 * offset inside a group.
 *
 * Kept pure and separate from the query hook because this index arithmetic is
 * exactly where off-by-one errors live, and it is trivially testable without a
 * coordinator, a network, or a DOM.
 */

/** A scalar group key. DuckDB returns numerics as numbers over the JSON path. */
export type GroupKey = string | number;

/** One group as the server reported it: its key and how many rows it contains. */
export interface GroupSummary {
  key: GroupKey;
  /** COUNT(*) within the group, over the FULL dataset, not a loaded page. */
  count: number;
}

/**
 * Prefix offsets for the flattened view.
 *
 * `headerAt[i]` is the flat index of group i's header row. Children of an expanded
 * group occupy the `count` slots immediately after its header.
 */
export interface GroupedLayout {
  groups: readonly GroupSummary[];
  /** Flat index of each group's header row; same length as `groups`. */
  headerAt: readonly number[];
  /** Total flat row count: every header plus the children of expanded groups. */
  totalCount: number;
}

/** Where a flat index lands. */
export type GroupedSlot =
  | { kind: "header"; groupIndex: number; group: GroupSummary }
  | { kind: "child"; groupIndex: number; group: GroupSummary; childOffset: number };

/**
 * Build the flattened layout. `isExpanded` is consulted once per group, so the
 * caller's expansion set need not be stable across calls.
 */
export function layoutGroups(groups: readonly GroupSummary[], isExpanded: (key: GroupKey) => boolean): GroupedLayout {
  const headerAt: number[] = [];
  let cursor = 0;
  for (const group of groups) {
    headerAt.push(cursor);
    // A header always occupies one slot; an expanded group then contributes its
    // children. A group with count 0 still gets a header, so an empty group under
    // an active filter stays visible rather than silently vanishing.
    cursor += 1 + (isExpanded(group.key) ? Math.max(0, group.count) : 0);
  }
  return { groups, headerAt, totalCount: cursor };
}

/**
 * Resolve a flat index to a header or a child.
 *
 * Binary search rather than a linear scan: this runs for every visible row on every
 * scroll frame, and the group list can be thousands long.
 */
export function slotAt(layout: GroupedLayout, index: number): GroupedSlot | undefined {
  const { groups, headerAt, totalCount } = layout;
  if (index < 0 || index >= totalCount || groups.length === 0) return undefined;

  // Last group whose header index is <= the target.
  let low = 0;
  let high = headerAt.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (headerAt[mid] <= index) low = mid;
    else high = mid - 1;
  }

  const groupIndex = low;
  const group = groups[groupIndex];
  const offset = index - headerAt[groupIndex];
  if (offset === 0) return { kind: "header", groupIndex, group };
  return { kind: "child", groupIndex, group, childOffset: offset - 1 };
}

/** Flat index of a group's header, for scroll-to-group. */
export function headerIndexOf(layout: GroupedLayout, key: GroupKey): number | undefined {
  const groupIndex = layout.groups.findIndex((g) => g.key === key);
  return groupIndex < 0 ? undefined : layout.headerAt[groupIndex];
}

/** A contiguous run of child offsets inside one group. */
export interface ChildRange {
  groupIndex: number;
  group: GroupSummary;
  /** First child offset within the group, inclusive. */
  from: number;
  /** Last child offset within the group, inclusive. */
  to: number;
}

/**
 * Child offsets needed to cover a flat range, split per group.
 *
 * The renderer asks in flat coordinates while the loader fetches per group with
 * `LIMIT`/`OFFSET`, so a visible range spanning a group boundary has to be broken
 * apart. Header slots inside the range contribute nothing to fetch.
 */
export function childRangesFor(layout: GroupedLayout, startIndex: number, endIndex: number): ChildRange[] {
  const ranges: ChildRange[] = [];
  let index = Math.max(0, startIndex);
  const last = Math.min(endIndex, layout.totalCount - 1);
  while (index <= last) {
    const slot = slotAt(layout, index);
    if (!slot) break;
    if (slot.kind === "header") {
      index += 1;
      continue;
    }
    // Flat index of this group's final child.
    const groupLastChild = layout.headerAt[slot.groupIndex] + slot.group.count;
    const stop = Math.min(last, groupLastChild);
    const from = slot.childOffset;
    ranges.push({ groupIndex: slot.groupIndex, group: slot.group, from, to: from + (stop - index) });
    index = stop + 1;
  }
  return ranges;
}
