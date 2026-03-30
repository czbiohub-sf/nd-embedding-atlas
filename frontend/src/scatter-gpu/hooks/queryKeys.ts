import type { Coordinator } from "@uwdata/mosaic-core";

export const colormapKeys = {
  list: () => ["colormaps", "list"] as const,
  palette: (colormap: string, n: number) => ["colormaps", "palette", colormap, n] as const,
} as const;

export const scatterKeys = {
  positions: (obsmKey: string, xCol: string, yCol: string) => ["scatter", "positions", obsmKey, xCol, yCol] as const,
  categories: (catCol: string, originalCol?: string | null) =>
    ["scatter", "categories", catCol, originalCol ?? null] as const,
  continuousColors: (colorCol: string, colormap: string, vmin?: number, vmax?: number) =>
    ["scatter", "continuous-colors", colorCol, colormap, vmin ?? null, vmax ?? null] as const,
  metadata: () => ["metadata"] as const,
  categoryCount: (coordinator: Coordinator, col: string) =>
    ["scatter", "category-count", coordinator, col] as const,
  rangeIsolation: (coordinator: Coordinator, col: string, vmin: number, vmax: number) =>
    ["scatter", "range-isolation", coordinator, col, vmin, vmax] as const,
} as const;

export const tableKeys = {
  rowPosition: (
    coordinator: Coordinator,
    table: string,
    rowIndex: number,
    filterKey: string,
    sortKey: string,
  ) => ["table", "row-position", coordinator, table, rowIndex, filterKey, sortKey] as const,
} as const;

export const trajectoryKeys = {
  track: (coordinator: Coordinator, table: string, trackId: number, fovName: string) =>
    ["trajectory", coordinator, table, trackId, fovName] as const,
} as const;

export const varKeys = {
  names: (query: string) => ["var", "names", query] as const,
} as const;
