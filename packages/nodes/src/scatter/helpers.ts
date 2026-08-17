import type { Selection } from "@uwdata/mosaic-core";
import { and, type ExprNode, type FilterExpr, literal } from "@uwdata/mosaic-sql";
import { okLchToSrgb, ParseColorError, srgbFromHex, srgbToHex, srgbToOkLch } from "@ndea/ochre";
import type { ColorMode, ColumnType, TrajectoryData } from "./contracts";

export interface OklchColor {
  l: number;
  c: number;
  h: number;
}

export function hexToOklch(hex: string): OklchColor | null {
  try {
    const { l, c, h } = srgbToOkLch(srgbFromHex(hex));
    return { l, c, h };
  } catch (error) {
    if (error instanceof ParseColorError) return null;
    throw error;
  }
}

export function oklchToHex(color: OklchColor): string {
  return srgbToHex(okLchToSrgb({ ...color, alpha: 1 }));
}

export type ColorSource =
  | { readonly kind: "none" }
  | { readonly kind: "obs"; readonly column: string }
  | { readonly kind: "var"; readonly varName: string; readonly layer: string; readonly column: string };

export const COLOR_NONE = { kind: "none" } as const satisfies ColorSource;

export function colorSourceObs(column: string): ColorSource & { kind: "obs" } {
  return { kind: "obs", column };
}

export function colorSourceVar(varName: string, layer: string): ColorSource & { kind: "var" } {
  const column = `__var_${varName.replace(/[^a-zA-Z0-9]/g, "_")}_${layer.replace(/[^a-zA-Z0-9]/g, "_")}__`;
  return { kind: "var", varName, layer, column };
}

const VAR_RE = /^__var_(.+)_([^_]+)__$/;

export function colorSourceFromString(column: string | null): ColorSource {
  if (!column) return COLOR_NONE;
  const match = column.match(VAR_RE);
  return match ? { kind: "var", varName: match[1], layer: match[2], column } : { kind: "obs", column };
}

export function colorSourceToString(source: ColorSource): string | null {
  return source.kind === "none" ? null : source.column;
}

export function isObsSource(source: ColorSource): source is ColorSource & { kind: "obs" } {
  return source.kind === "obs";
}

export function isVarSource(source: ColorSource): source is ColorSource & { kind: "var" } {
  return source.kind === "var";
}

export function colorSourceLabel(source: ColorSource): string {
  return source.kind === "none" ? "none" : source.kind === "var" ? source.varName : source.column;
}

export function colorSourceLegendLabel(source: ColorSource): string {
  return source.kind === "none" ? "" : source.kind === "var" ? source.layer : source.column;
}

export function getModality(obsmKey: string): string | undefined {
  const separator = obsmKey.indexOf(":");
  return separator > 0 ? obsmKey.slice(0, separator) : undefined;
}

export function getBareObsmKey(obsmKey: string): string {
  const separator = obsmKey.indexOf(":");
  return separator > 0 ? obsmKey.slice(separator + 1) : obsmKey;
}

export function filterExprToExpr(filter: FilterExpr | null | undefined): ExprNode {
  if (filter == null) return literal(true);
  if (typeof filter === "boolean") return literal(filter);
  if (typeof filter === "string") return literal(true);
  if (Array.isArray(filter)) {
    const expressions = filter.filter(
      (value): value is ExprNode => value != null && typeof value !== "boolean" && typeof value !== "string",
    );
    if (expressions.length === 0) return literal(true);
    return expressions.length === 1 ? expressions[0] : and(...expressions);
  }
  return filter;
}

export function toRows<T = Record<string, unknown>>(result: unknown): T[] {
  return Array.isArray(result) ? result : Array.from(result as Iterable<T>);
}

export function predicateToSql(selection: Selection): string | null {
  const predicate = selection.predicate(null);
  if (predicate == null) return null;
  if (Array.isArray(predicate)) {
    if (predicate.length === 0) return null;
    return and(...predicate)
      .toString()
      .trim();
  }
  if (typeof predicate === "string") return predicate.trim() || null;
  if (typeof predicate === "boolean") return literal(predicate).toString();
  return predicate.toString().trim();
}

export function stringPredicate(sql: string): ExprNode {
  return { toString: () => sql } as unknown as ExprNode;
}

export function resolveColorMode(
  columnName: string | null,
  columnTypes: Map<string, ColumnType> | null,
  userOverride?: ColorMode,
): { mode: ColorMode; canToggle: boolean } {
  if (!columnName || !columnTypes) return { mode: "categorical", canToggle: false };
  if (columnName.startsWith("__var_") && columnName.endsWith("__")) {
    return { mode: userOverride ?? "continuous", canToggle: false };
  }
  const dtype = columnTypes.get(columnName);
  return {
    mode: userOverride ?? (dtype === "number" ? "continuous" : "categorical"),
    canToggle: dtype === "number",
  };
}

export function selectAnyTrajectory(
  trajectories: Readonly<Record<string, TrajectoryData | null>>,
): TrajectoryData | null {
  for (const trajectory of Object.values(trajectories)) {
    if (trajectory) return trajectory;
  }
  return null;
}

export const scatterKeys = {
  positions: (obsmKey: string, xCol: string, yCol: string) => ["scatter", "positions", obsmKey, xCol, yCol] as const,
  categories: (catCol: string, originalCol?: string | null) =>
    ["scatter", "categories", catCol, originalCol ?? null] as const,
  continuousColors: (colorCol: string, colormap: string, vmin?: number, vmax?: number) =>
    ["scatter", "continuous-colors", colorCol, colormap, vmin ?? null, vmax ?? null] as const,
} as const;

export const trajectoryKeys = {
  track: (table: string, trackId: number, fovName: string) => ["trajectory", table, trackId, fovName] as const,
} as const;

export const varKeys = {
  names: (query: string, modality?: string) => ["var", "names", query, modality ?? null] as const,
} as const;

export const WIRE_FOCUS_COLOR = "#68cdf2";
export const TRAJECTORY_COLOR = "#68cdf2";
