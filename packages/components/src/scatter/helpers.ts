import { okLchToSrgb, ParseColorError, srgbFromHex, srgbToHex, srgbToOkLch } from "@ndea/colors";
import type { Columns } from "../query/columns";
import type { ColorMode, TrajectoryData } from "./contracts";
import type { ScatterData } from "./gpu/types";

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

const VAR_RE = /^__var_(.+)_([^_]+)__$/;

export function colorSourceFromString(column: string | null): ColorSource {
  if (!column) return COLOR_NONE;
  const match = column.match(VAR_RE);
  return match ? { kind: "var", varName: match[1], layer: match[2], column } : { kind: "obs", column };
}

export function colorSourceToString(source: ColorSource): string | null {
  return source.kind === "none" ? null : source.column;
}

export function isVarSource(source: ColorSource): source is ColorSource & { kind: "var" } {
  return source.kind === "var";
}

export function colorSourceLegendLabel(source: ColorSource): string {
  return source.kind === "none" ? "" : source.kind === "var" ? source.layer : source.column;
}

export function getModality(obsmKey: string): string | undefined {
  const separator = obsmKey.indexOf(":");
  return separator > 0 ? obsmKey.slice(0, separator) : undefined;
}

function getBareObsmKey(obsmKey: string): string {
  const separator = obsmKey.indexOf(":");
  return separator > 0 ? obsmKey.slice(separator + 1) : obsmKey;
}

const DIM_NAMES: Record<string, string> = { umap: "UMAP", pca: "PC", tsne: "tSNE", phate: "PHATE" };

/** Axis label of embedding dimension `dim` (0-based): "X_umap", 0 → "UMAP1"; "rna:X_pca", 1 → "PC2"; "X_dinov2", 0 → "dinov2 1". */
export function dimLabel(obsmKey: string, dim: number): string {
  const name = getBareObsmKey(obsmKey).replace(/^X_/, "");
  const known = DIM_NAMES[name.toLowerCase()];
  return known ? `${known}${dim + 1}` : `${name} ${dim + 1}`;
}

export function resolveColorMode(
  columnName: string | null,
  columns: Columns | null,
  userOverride?: ColorMode,
): { mode: ColorMode; canToggle: boolean } {
  if (!columnName || !columns) return { mode: "categorical", canToggle: false };
  if (columnName.startsWith("__var_") && columnName.endsWith("__")) {
    return { mode: userOverride ?? "continuous", canToggle: false };
  }
  const dtype = columns.get(columnName)?.type;
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
  positions: (obsmKey: string, xCol: string, yCol: string, zCol: string | null) =>
    ["scatter", "positions", obsmKey, xCol, yCol, zCol] as const,
  categories: (catCol: string, originalCol?: string | null) =>
    ["scatter", "categories", catCol, originalCol ?? null] as const,
  continuousColors: (colorCol: string, colormap: string, vmin?: number, vmax?: number) =>
    ["scatter", "continuous-colors", colorCol, colormap, vmin ?? null, vmax ?? null] as const,
} as const;

export const trajectoryKeys = {
  track: (trackId: number, fovName: string, categoryCol: string | null) =>
    ["trajectory", trackId, fovName, categoryCol] as const,
} as const;

/** Normalized world position of point `row` exactly as the GPU draws it (z = 0 in 2D); null if not loaded. */
export function pointWorldPos(data: ScatterData | null, row: number): [number, number, number] | null {
  if (!data || row >= data.numCells) return null;
  const { positions: p, numCells: n } = data;
  return [p[row], p[n + row], data.ndim === 3 ? p[2 * n + row] : 0];
}

export const varKeys = {
  names: (query: string, modality?: string) => ["var", "names", query, modality ?? null] as const,
} as const;

export const WIRE_FOCUS_COLOR = "#68cdf2";
export const TRAJECTORY_COLOR = "#68cdf2";
