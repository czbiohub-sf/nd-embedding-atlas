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
export const CATEGORY_MAX = 200;

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

/** Fields rows can be grouped by. */
export const isGroupable = (type: FieldType) => type === "category" || type === "label" || type === "boolean";

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
export function conditionClause(condition: Condition, type: FieldType): FilterClause | null {
  const { column, op, value } = condition;
  if (op === "isNull" || op === "isNotNull") return { op, column };
  if (value === "") return null;
  if (type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? { op, column, value: n } : null;
  }
  return { op, column, value: type === "boolean" ? value === "true" : value };
}

/** AND of the complete conditions: null when none, the clause itself when one. */
export function conditionsClause(
  conditions: readonly Condition[],
  typeOf: (column: string) => FieldType | undefined,
): FilterClause | null {
  const clauses = conditions.flatMap((c) => {
    const type = typeOf(c.column);
    const clause = type ? conditionClause(c, type) : null;
    return clause ? [clause] : [];
  });
  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0] : { op: "and", clauses };
}

/** Back from a published clause to builder rows; shapes the builder can't show are dropped. */
export function clauseConditions(clause: FilterClause | undefined): Condition[] {
  if (!clause) return [];
  switch (clause.op) {
    case "and":
      return clause.clauses.flatMap(clauseConditions);
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

/** ORDER BY body: group, then sort, then the stable row order. */
export function orderBySql(sort: SortState | null, groupBy: string | null): string {
  const keys = [
    groupBy ? `${quoteIdent(groupBy)} ASC NULLS LAST` : null,
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
  readonly value: GroupValue;
  readonly count: number;
}

export const groupKey = (value: GroupValue) => (value === null ? "\u0000null" : String(value));

/** A virtual list item: a group header, or the row at `position` in the query's order. */
export type TableItem = { kind: "group"; group: Group; collapsed: boolean } | { kind: "row"; position: number };

/**
 * Lays groups out as `header, rows…` (rows only when expanded) over the flat
 * row order, which is sorted by the group first, so group `g`'s rows are the
 * positions `offset[g] … offset[g] + count - 1`.
 */
export class GroupLayout {
  readonly length: number;
  private readonly starts: number[] = [];
  private readonly offsets: number[] = [];
  private readonly groups: readonly Group[];
  private readonly collapsed: ReadonlySet<string>;

  constructor(groups: readonly Group[], collapsed: ReadonlySet<string>) {
    this.groups = groups;
    this.collapsed = collapsed;
    let start = 0;
    let offset = 0;
    for (const group of groups) {
      this.starts.push(start);
      this.offsets.push(offset);
      start += 1 + (collapsed.has(groupKey(group.value)) ? 0 : group.count);
      offset += group.count;
    }
    this.length = start;
  }

  /** The group whose span holds `x` in `within` (starts or offsets). */
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
    const g = this.find(this.starts, index);
    const group = this.groups[g];
    const local = index - this.starts[g];
    if (local === 0) return { kind: "group", group, collapsed: this.collapsed.has(groupKey(group.value)) };
    return { kind: "row", position: this.offsets[g] + local - 1 };
  }

  /** Virtual index of row `position`: its header when the group is collapsed. */
  indexOf(position: number): number {
    const g = this.find(this.offsets, position);
    const group = this.groups[g];
    if (this.collapsed.has(groupKey(group.value))) return this.starts[g];
    return this.starts[g] + 1 + position - this.offsets[g];
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
