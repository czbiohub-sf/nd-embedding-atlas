/**
 * Pure model of the table: field types, the filter builder's conditions and
 * their typed clauses, ordering and search SQL, the grouped row layout, and
 * the row-selection bitmask. No React, so it is unit-tested directly.
 */

import { type AnnotationDtype, type ColumnType, type FilterClause, quoteIdent } from "@ndea/protocol";

/** Text, number, category (from the file), label (editable categorical field), boolean. */
export type FieldType = "text" | "number" | "category" | "label" | "boolean";

export interface TableField {
  readonly name: string;
  readonly type: FieldType;
  /** The annotation field's type; null for obs from the file (read-only). */
  readonly annotation: AnnotationDtype | null;
}

export const FIELD_GLYPH: Record<FieldType, string> = {
  text: "Aa",
  number: "#",
  category: "◉",
  label: "◇",
  boolean: "☑",
};

/** A string obs column with at most this many distinct values is a category. */
// ponytail: a distinct-count heuristic; read the AnnData categorical encoding if it misjudges.
const CATEGORY_MAX = 200;

export function fieldType(
  columnType: ColumnType,
  distinct: number | undefined,
  annotation: AnnotationDtype | null,
): FieldType {
  if (annotation) return annotation;
  if (columnType === "number") return "number";
  if (columnType === "boolean") return "boolean";
  return distinct !== undefined && distinct <= CATEGORY_MAX ? "category" : "text";
}

/** Fields whose values are strings: search covers these. */
export const isStringField = (type: FieldType) => type === "text" || type === "category" || type === "label";

/** Fields obs can be grouped by: every type but free text. */
export const isGroupable = (type: FieldType) => type !== "text";

/** A cell value as the table and gallery print it. */
export function formatValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
  if (typeof value === "bigint") return value.toLocaleString("en-US");
  if (value instanceof Date) return value.toISOString();
  return typeof value === "object" ? JSON.stringify(value) : String(value as string | boolean);
}

// ── Filter builder ──────────────────────────────────────────────────

export type ConditionOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "isNull" | "isNotNull";

export interface Condition {
  readonly column: string;
  readonly op: ConditionOp;
  /** Typed into the builder; ignored by isNull / isNotNull. */
  readonly value: string;
}

const EMPTY_OPS = [
  { op: "isNull", label: "is empty" },
  { op: "isNotNull", label: "is not empty" },
] as const;

export const CONDITION_OPS: Record<FieldType, readonly { op: ConditionOp; label: string }[]> = {
  number: [
    { op: "eq", label: "=" },
    { op: "neq", label: "≠" },
    { op: "lt", label: "<" },
    { op: "lte", label: "≤" },
    { op: "gt", label: ">" },
    { op: "gte", label: "≥" },
    ...EMPTY_OPS,
  ],
  boolean: [{ op: "eq", label: "is" }, ...EMPTY_OPS],
  text: [{ op: "eq", label: "is" }, { op: "neq", label: "is not" }, ...EMPTY_OPS],
  category: [{ op: "eq", label: "is" }, { op: "neq", label: "is not" }, ...EMPTY_OPS],
  label: [{ op: "eq", label: "is" }, { op: "neq", label: "is not" }, ...EMPTY_OPS],
};

/** The typed clause for one condition; null while its value is incomplete. */
function conditionClause(condition: Condition, type: FieldType): FilterClause | null {
  const { column, op, value } = condition;
  if (op === "isNull" || op === "isNotNull") return { op, column };
  if (value === "") return null;
  if (type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? { op, column, value: n } : null;
  }
  return { op, column, value: type === "boolean" ? value === "true" : value };
}

/** How the builder joins its conditions: every one (and) or any one (or). */
export type Conjunction = "and" | "or";

/** The conditions joined by `conjunction`: null when none is complete, the clause itself when one is. */
export function conditionsClause(
  conditions: readonly Condition[],
  typeOf: (column: string) => FieldType | undefined,
  conjunction: Conjunction = "and",
): FilterClause | null {
  const clauses = conditions.flatMap((c) => {
    const type = typeOf(c.column);
    const clause = type ? conditionClause(c, type) : null;
    return clause ? [clause] : [];
  });
  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0] : { op: conjunction, clauses };
}

/** The conjunction of a published clause. */
export const clauseConjunction = (clause: FilterClause | undefined): Conjunction =>
  clause?.op === "or" ? "or" : "and";

/** Back from a published clause to builder rows; shapes the builder can't show are dropped. */
export function clauseConditions(clause: FilterClause | undefined): Condition[] {
  if (!clause) return [];
  return clause.op === "and" || clause.op === "or" ? clause.clauses.flatMap(leafCondition) : leafCondition(clause);
}

function leafCondition(clause: FilterClause): Condition[] {
  switch (clause.op) {
    case "isNull":
    case "isNotNull":
      return [{ column: clause.column, op: clause.op, value: "" }];
    case "eq":
    case "neq":
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      return [{ column: clause.column, op: clause.op, value: String(clause.value) }];
    default:
      return [];
  }
}

// ── Query SQL ───────────────────────────────────────────────────────

export interface SortState {
  readonly col: string;
  readonly dir: "asc" | "desc";
}

/** ORDER BY body: the group fields, then sort, then the stable row order. */
export function orderBySql(sort: SortState | null, groupBy: readonly string[]): string {
  const keys = [
    ...groupBy.map((g) => `${quoteIdent(g)} ASC NULLS LAST`),
    sort ? `${quoteIdent(sort.col)} ${sort.dir === "desc" ? "DESC" : "ASC"} NULLS LAST` : null,
    "__row_index__",
  ];
  return keys.filter(Boolean).join(", ");
}

/** Case-insensitive substring match over `columns`; null when there is nothing to search. */
export function searchSql(text: string, columns: readonly string[]): string | null {
  const term = text.trim();
  if (!term || columns.length === 0) return null;
  const pattern = `'%${term.replace(/[\\%_]/g, (c) => `\\${c}`).replaceAll("'", "''")}%'`;
  return columns.map((c) => `${quoteIdent(c)} ILIKE ${pattern} ESCAPE '\\'`).join(" OR ");
}

/** AND of the non-null predicates; null when all are null. */
export function andSql(predicates: readonly (string | null)[]): string | null {
  const parts = predicates.filter((p): p is string => !!p);
  return parts.length ? parts.map((p) => `(${p})`).join(" AND ") : null;
}

// ── Grouped layout ──────────────────────────────────────────────────

export type GroupValue = string | number | boolean | null;

export interface Group {
  /** One value per group field, in `groupBy` order. */
  readonly values: readonly GroupValue[];
  readonly count: number;
}

export const groupKey = (values: readonly GroupValue[]) => JSON.stringify(values);

/** A group's values as its header prints them: `a · b`, empty for null. */
export const groupLabel = (values: readonly GroupValue[]) =>
  values.map((v) => (v === null ? "empty" : formatValue(v))).join(" · ");

/**
 * A virtual list item: the header of a group level (its values are the
 * prefix up to `level`, its count every obs under it), or `count` rows from
 * `position` in the query's order, all in the innermost `group`.
 */
export type TableItem =
  | { kind: "group"; group: Group; level: number; collapsed: boolean }
  | { kind: "row"; position: number; count: number; group: Group | null };

type Entry =
  | { start: number; kind: "group"; group: Group; level: number; collapsed: boolean }
  | { start: number; kind: "lines"; offset: number; group: Group };

/**
 * Lays nested groups out like Airtable: a header whenever a level's value
 * changes (`a`, then `a · x`, `a · y`, then `b`, `b · x`), then the lines of
 * each innermost group, over the flat row order (sorted by the group fields
 * first, so innermost group `g`'s rows are `offset[g] … offset[g] + count - 1`).
 * A collapsed header hides everything under it. A line holds `perLine` rows:
 * one in the table, a row of tiles in the gallery grid; `Infinity` puts each
 * innermost group on one line (a gallery strip) and drops its own header.
 */
export class GroupLayout {
  readonly length: number;
  private readonly entries: Entry[] = [];
  private readonly starts: number[] = [];
  /** Per innermost group: its first row's position, and the virtual index that shows it. */
  private readonly offsets: number[] = [];
  private readonly shownAt: number[] = [];
  private readonly expanded: boolean[] = [];
  private readonly perLine: number;

  constructor(groups: readonly Group[], collapsed: ReadonlySet<string>, perLine = 1) {
    this.perLine = perLine;
    const depth = groups[0]?.values.length ?? 0;
    const headed = perLine === Infinity ? depth - 1 : depth;
    const runs: { values: readonly GroupValue[]; count: number }[] = [];
    let start = 0;
    let offset = 0;
    /** The shallowest collapsed level still open, and its header's index. */
    let hiddenAt = Infinity;
    let hiddenIndex = 0;
    groups.forEach((group, g) => {
      const previous = groups[g - 1]?.values;
      let changed = 0;
      while (previous && changed < depth && previous[changed] === group.values[changed]) changed++;
      if (changed <= hiddenAt) hiddenAt = Infinity;
      for (let level = changed; level < headed; level++) {
        const run = { values: group.values.slice(0, level + 1), count: 0 };
        runs[level] = run;
        const isCollapsed = collapsed.has(groupKey(run.values));
        if (hiddenAt < level) continue;
        this.entries.push({ start, kind: "group", group: run, level, collapsed: isCollapsed });
        if (isCollapsed) {
          hiddenAt = level;
          hiddenIndex = start;
        }
        start += 1;
      }
      for (let level = 0; level < headed; level++) runs[level].count += group.count;
      this.offsets.push(offset);
      this.expanded.push(hiddenAt === Infinity);
      if (hiddenAt === Infinity) {
        this.entries.push({ start, kind: "lines", offset, group });
        this.shownAt.push(start);
        start += perLine === Infinity ? 1 : Math.ceil(group.count / perLine);
      } else this.shownAt.push(hiddenIndex);
      offset += group.count;
    });
    this.starts = this.entries.map((e) => e.start);
    this.length = start;
  }

  /** The last index in `within` whose value is at or before `x`. */
  private find(within: number[], x: number): number {
    let lo = 0;
    let hi = within.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (within[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  item(index: number): TableItem {
    const entry = this.entries[this.find(this.starts, index)];
    if (entry.kind === "group") {
      const { group, level, collapsed } = entry;
      return { kind: "group", group, level, collapsed };
    }
    const { group } = entry;
    if (this.perLine === Infinity) return { kind: "row", position: entry.offset, count: group.count, group };
    const skip = (index - entry.start) * this.perLine;
    return { kind: "row", position: entry.offset + skip, count: Math.min(this.perLine, group.count - skip), group };
  }

  /** Virtual index of row `position`: the collapsed header above it when it is hidden. */
  indexOf(position: number): number {
    const g = this.find(this.offsets, position);
    if (!this.expanded[g] || this.perLine === Infinity) return this.shownAt[g];
    return this.shownAt[g] + Math.floor((position - this.offsets[g]) / this.perLine);
  }
}

// ── Row selection ───────────────────────────────────────────────────

/** Row bitmask over all `rows` obs: bit `r & 31` of word `r >> 5` is row `r` (the `/api/sets` format). */
export const emptyBits = (rows: number) => new Uint32Array(Math.ceil(rows / 32));

export const hasBit = (bits: Uint32Array, row: number) => ((bits[row >> 5] >>> (row & 31)) & 1) === 1;

/** A copy of `bits` with `rows` set (or cleared when `on` is false). */
export function withBits(
  bits: Uint32Array<ArrayBuffer>,
  rows: Iterable<number>,
  on: boolean,
): Uint32Array<ArrayBuffer> {
  const next = bits.slice();
  for (const row of rows) {
    if (on) next[row >> 5] |= 1 << (row & 31);
    else next[row >> 5] &= ~(1 << (row & 31));
  }
  return next;
}

export function countBits(bits: Uint32Array): number {
  let n = 0;
  for (let w of bits) {
    while (w) {
      w &= w - 1;
      n++;
    }
  }
  return n;
}
