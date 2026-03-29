export const colormapKeys = {
  list: () => ["colormaps", "list"] as const,
  palette: (colormap: string, n: number) =>
    ["colormaps", "palette", colormap, n] as const,
} as const;

export const scatterKeys = {
  positions: (obsmKey: string, xCol: string, yCol: string) =>
    ["scatter", "positions", obsmKey, xCol, yCol] as const,
  categories: (catCol: string, originalCol?: string | null) =>
    ["scatter", "categories", catCol, originalCol ?? null] as const,
  continuousColors: (colorCol: string, colormap: string, vmin?: number, vmax?: number) =>
    ["scatter", "continuous-colors", colorCol, colormap, vmin ?? null, vmax ?? null] as const,
  metadata: () => ["metadata"] as const,
} as const;
