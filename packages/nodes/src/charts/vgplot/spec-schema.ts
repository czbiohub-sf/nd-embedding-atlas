/**
 * Config contract for the `vgplot` node: a JSON-serializable mosaic-spec plot.
 *
 * The config IS the spec body. `entries` is the `plot: [...]` array (marks and
 * interactors, order-significant) and `attributes` is everything else on the
 * mosaic-spec `Plot` object. Both are plain `JsonValue`, so the whole thing
 * round-trips through `NodeConfigSnapshot.value` untouched.
 *
 * Three param names are reserved and supplied by the plot host at mount time,
 * never baked into the config:
 * - `$table`  the backing table name (a `Param`; mosaic-plot `Mark` resolves
 *             `isParam(source.table)` to `table.value`, see Mark.js:67,131)
 * - `$scope`  the node's input predicate `Selection`, via mark `filterBy`
 * - `$brush`  the interactor's output `Selection`, read back out of `astToDOM`
 */

import type { Coordinator } from "@uwdata/mosaic-core";
import { z } from "zod";
import type { JsonValue } from "@ndea/sdk";
import type { ColumnType } from "../core/contracts";
import { toRows } from "../core/mosaic-helpers";

/**
 * One entry of a mosaic-spec `plot: [...]` array. A mark entry carries a
 * `mark: string` key (`parseMark` in PlotMarkNode.js destructures `mark`); an
 * interactor entry carries `select: string` (`parseInteractor` in
 * PlotInteractorNode.js destructures the `SELECT` key). Every other key is
 * passed straight through to mosaic.
 */
export type PlotEntry = Record<string, JsonValue>;

export interface VgplotConfig {
  entries: PlotEntry[];
  attributes: Record<string, JsonValue>;
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const plotEntrySchema: z.ZodType<PlotEntry> = z
  .record(z.string(), jsonValueSchema)
  .refine((entry) => typeof entry.mark === "string" || typeof entry.select === "string", {
    message: "plot entry must declare a `mark` or `select` string",
  });

export const vgplotConfigSchema: z.ZodType<VgplotConfig> = z.object({
  entries: z.array(plotEntrySchema),
  attributes: z.record(z.string(), jsonValueSchema),
});

export const VGPLOT_DEFAULT_CONFIG: VgplotConfig = { entries: [], attributes: {} };

/** Data source shared by every preset: host-supplied table, scope-filtered. */
const markData = (): PlotEntry => ({ from: "$table", filterBy: "$scope" });

export type MarkPreset = "histogram" | "count";

export const MARK_PRESETS: readonly MarkPreset[] = ["histogram", "count"];

/** Column kinds each preset can plot, for the field picker. */
export const PRESET_COLUMN_KINDS: Readonly<Record<MarkPreset, readonly ColumnType[]>> = {
  histogram: ["number"],
  count: ["string", "boolean"],
};

/**
 * Build the `plot: [...]` entries for a preset over one column.
 *
 * Order is load-bearing: a mosaic-spec interactor binds to the nearest
 * *preceding* mark, so the mark must come first.
 */
export function buildEntries(preset: MarkPreset, field: string): PlotEntry[] {
  if (preset === "histogram") {
    return [
      // Rect.d.ts: `mark: 'rectY'`. Transform.d.ts Bin: `bin: Arg | [Arg]`;
      // Count: `count: Arg0 | Arg1` where `Arg0 = null | []`.
      { mark: "rectY", data: markData(), x: { bin: field }, y: { count: [] } },
      // Interval1D.d.ts IntervalX: `select: 'intervalX'`, `as: ParamRef`, `field?: string`.
      // The binned numeric field is on x, so an x-interval is the right brush.
      { select: "intervalX", as: "$brush", field },
    ];
  }
  return [
    // Bar.d.ts: `mark: 'barY'`, BarY `x?: ChannelValueSpec` (the ordinal group).
    { mark: "barY", data: markData(), x: field, y: { count: [] } },
    // Toggle.d.ts ToggleX: `select: 'toggleX'`, `as: ParamRef`. Must be x, not y:
    // the category is on x and the count aggregate on y, so toggling y would
    // build a clause over the aggregate and filter nothing meaningful.
    { select: "toggleX", as: "$brush" },
  ];
}

/**
 * Recover `{ preset, field }` from entries built by `buildEntries`.
 *
 * The config stores only the spec, so the editor UI reads its own state back
 * out of it. Returns null for hand-authored or unrecognized entries.
 */
export function describeEntries(entries: readonly PlotEntry[]): { preset: MarkPreset; field: string } | null {
  const mark = entries[0];
  if (mark === undefined) return null;

  if (mark.mark === "rectY") {
    const bin = isRecord(mark.x) ? mark.x.bin : undefined;
    const field = typeof bin === "string" ? bin : Array.isArray(bin) && typeof bin[0] === "string" ? bin[0] : null;
    return field === null ? null : { preset: "histogram", field };
  }

  if (mark.mark === "barY" && typeof mark.x === "string") {
    return { preset: "count", field: mark.x };
  }

  return null;
}

function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Internal columns hidden from the picker, matching `FieldPicker`. */
const SKIP_COLUMNS = new Set(["__row_index__"]);

/**
 * Column name → kind, straight off the coordinator. The non-React twin of
 * `useColumnTypes`: the vgplot body is imperative and cannot call hooks.
 */
export async function listColumns(coordinator: Coordinator): Promise<Map<string, ColumnType>> {
  const result = await coordinator.query(`SELECT column_name, column_type FROM (DESCRIBE dataset)`);
  const rows = toRows<{ column_name: string; column_type: string }>(result);

  const columns = new Map<string, ColumnType>();
  for (const row of rows) {
    if (SKIP_COLUMNS.has(row.column_name)) continue;
    columns.set(row.column_name, duckdbTypeToColumnType(row.column_type));
  }
  return columns;
}

/** DuckDB type name to chart picker kind. */
function duckdbTypeToColumnType(dtype: string): ColumnType {
  const d = dtype.toUpperCase();
  if (
    d.includes("INT") ||
    d.includes("FLOAT") ||
    d.includes("DOUBLE") ||
    d.includes("DECIMAL") ||
    d.includes("NUMERIC") ||
    d.includes("REAL") ||
    d.includes("HUGEINT") ||
    d.includes("BIGINT") ||
    d.includes("SMALLINT") ||
    d.includes("TINYINT")
  ) {
    return "number";
  }
  if (d.includes("BOOL")) return "boolean";
  if (d.includes("VARCHAR") || d.includes("TEXT") || d.includes("CHAR") || d.includes("STRING") || d.includes("ENUM")) {
    return "string";
  }
  return "other";
}
