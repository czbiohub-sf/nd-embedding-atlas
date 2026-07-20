// Note: Coordinator is intentionally excluded from all query keys: it contains
// circular references that break TanStack Query's JSON.stringify-based key hashing.
// There is one coordinator per app session so keys are still unique without it.

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
  categoryCount: (col: string) => ["scatter", "category-count", col] as const,
  rangeIsolation: (col: string, vmin: number, vmax: number) => ["scatter", "range-isolation", col, vmin, vmax] as const,
} as const;

export const tableKeys = {
  rowPosition: (table: string, rowIndex: number, filterKey: string, sortKey: string) =>
    ["table", "row-position", table, rowIndex, filterKey, sortKey] as const,
} as const;

export const trajectoryKeys = {
  track: (table: string, trackId: number, fovName: string) => ["trajectory", table, trackId, fovName] as const,
} as const;

export const varKeys = {
  names: (query: string, modality?: string) => ["var", "names", query, modality ?? null] as const,
} as const;
