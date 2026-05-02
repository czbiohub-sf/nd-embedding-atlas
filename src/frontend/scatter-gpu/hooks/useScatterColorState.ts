import type { Coordinator } from "@uwdata/mosaic-core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ColorMode } from "../../hooks/useColorMode";
import { resolveColorMode } from "../../hooks/useColorMode";
import { useColormapList, useColormapPalette } from "../../hooks/useColormaps";
import { useColumnTypes } from "../../hooks/useColumnTypes";
import { type CategoryMapping, makeCategoryColumn } from "../../lib/category-column";
import { type ColorSource, colorSourceFromString, colorSourceToString } from "../../lib/color-source";
import { toRows } from "../../lib/mosaic-helpers";
import { pickDefaultCategoricalPalette } from "../../lib/ochre-palette";
import type { Metadata } from "../../types";

export interface ScatterColorState {
  // Column selection
  colorByColumn: string | null;
  setColorByColumn: (col: string | null) => void;
  // ColorSource API (new — preferred over raw string)
  colorSource: ColorSource;
  setColorSource: (src: ColorSource) => void;
  obsColumns: string[];

  // Color mode
  colorMode: ColorMode;
  colorModeOverride: ColorMode | undefined;
  setColorModeOverride: (m: ColorMode | undefined) => void;
  colorModeInfo: { mode: ColorMode; canToggle: boolean };

  // Colormaps
  categoricalColormap: string;
  setCategoricalColormap: (c: string) => void;
  continuousColormap: string;
  setContinuousColormap: (c: string) => void;
  maxCategories: number;
  setMaxCategories: (n: number) => void;
  categoricalColormaps: string[];
  continuousColormaps: string[];
  palette: string[];

  // Category mapping
  categoryMapping: CategoryMapping | null;
  categoryLoading: boolean;
  coloredCategoryMapping: CategoryMapping | null;
  categoryCol: string | null;
  clearCategoryMapping: () => void;
}

export function useScatterColorState(coordinator: Coordinator, metadata: Metadata): ScatterColorState {
  // ── Column selection ────────────────────────────────────────────────────────
  const [colorByColumn, setColorByColumn] = useState<string | null>(null);
  const obsColumns = useMemo(() => metadata.obs_columns ?? [], [metadata.obs_columns]);

  // ── Color mode (categorical vs continuous) ──────────────────────────────────
  const columnTypes = useColumnTypes(coordinator);
  const [colorModeOverride, setColorModeOverride] = useState<ColorMode | undefined>();

  // Reset override when color column changes
  useEffect(() => {
    setColorModeOverride(undefined);
  }, []);

  const colorModeInfo = useMemo(
    () => resolveColorMode(colorByColumn, columnTypes, colorModeOverride),
    [colorByColumn, columnTypes, colorModeOverride],
  );
  const colorMode: ColorMode = colorModeInfo.mode;

  // ── Colormap state ──────────────────────────────────────────────────────────
  // Default is auto-picked per category count on column change (see effect
  // below). User's explicit pick via setCategoricalColormap is preserved
  // within a column but reset when the column changes.
  const [categoricalColormap, setCategoricalColormapInternal] = useState("tab10");
  const userExplicitPaletteRef = useRef(false);
  const setCategoricalColormap = (c: string) => {
    userExplicitPaletteRef.current = true;
    setCategoricalColormapInternal(c);
  };
  const [continuousColormap, setContinuousColormap] = useState("viridis");
  const [maxCategories, setMaxCategories] = useState(64);

  // Colormap lists + palette — cached via TanStack Query (no repeated fetches)
  const colormapListQuery = useColormapList();
  const categoricalColormaps = colormapListQuery.data?.categorical ?? [];
  const continuousColormaps = colormapListQuery.data?.continuous ?? [];

  const paletteQuery = useColormapPalette(categoricalColormap, maxCategories);
  const palette = useMemo(() => paletteQuery.data ?? [], [paletteQuery.data]);

  // ── Category column mapping ─────────────────────────────────────────────────
  // useQuery handles cancellation on unmount + cross-panel dedup (two panels
  // coloring by the same column share one DuckDB materialization). Coordinator
  // identity in the key drops stale mappings on backend restart.
  const categoryQuery = useQuery({
    queryKey: ["category-mapping", colorByColumn, colorMode] as const,
    enabled: !!colorByColumn && colorMode === "categorical",
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async () => {
      const col = colorByColumn as string;
      const countResult = await coordinator.query(
        `SELECT COUNT(DISTINCT CAST("${col}" AS TEXT))::INT AS n FROM obs_base`,
        { type: "json" },
      );
      const n = Math.min(toRows<{ n: number }>(countResult)[0]?.n ?? 64, 256);
      const mapping = await makeCategoryColumn(coordinator, col, n);
      return { n, mapping };
    },
  });

  const categoryMapping = categoryQuery.data?.mapping ?? null;
  const categoryLoading = categoryQuery.isFetching;

  // Propagate the discovered category count up so the palette sizes correctly.
  useEffect(() => {
    if (categoryQuery.data?.n != null) setMaxCategories(categoryQuery.data.n);
  }, [categoryQuery.data?.n]);

  // Reset "user explicit" when the column changes — the next count-derived
  // auto-pick should take over for a fresh column.
  useEffect(() => {
    userExplicitPaletteRef.current = false;
  }, [colorByColumn]);

  // Auto-pick the default palette based on category count unless the user
  // has explicitly chosen one for this column.
  useEffect(() => {
    if (userExplicitPaletteRef.current) return;
    const n = categoryQuery.data?.n;
    if (n == null) return;
    setCategoricalColormapInternal(pickDefaultCategoricalPalette(n));
  }, [categoryQuery.data?.n]);

  // Re-apply palette to existing mapping without touching DuckDB.
  // Return null (not categoryMapping) when palette isn't loaded yet — empty
  // color strings would propagate to the GPU and never trigger a re-color.
  const coloredCategoryMapping = useMemo(() => {
    if (!categoryMapping || palette.length === 0) return null;
    return {
      ...categoryMapping,
      legend: categoryMapping.legend.map((item) => ({
        ...item,
        color: palette[item.index % palette.length],
      })),
    };
  }, [categoryMapping, palette]);

  const categoryCol = coloredCategoryMapping?.indexColumn ?? null;

  const colorSource = useMemo(() => colorSourceFromString(colorByColumn), [colorByColumn]);
  const setColorSource = useMemo(() => (src: ColorSource) => setColorByColumn(colorSourceToString(src)), []);

  return {
    colorByColumn,
    setColorByColumn,
    colorSource,
    setColorSource,
    obsColumns,
    colorMode,
    colorModeOverride,
    setColorModeOverride,
    colorModeInfo,
    categoricalColormap,
    setCategoricalColormap,
    continuousColormap,
    setContinuousColormap,
    maxCategories,
    setMaxCategories,
    categoricalColormaps,
    continuousColormaps,
    palette,
    categoryMapping,
    categoryLoading,
    coloredCategoryMapping,
    categoryCol,
    clearCategoryMapping: () => {
      // Drop the cached category query entry so a subsequent switch
      // back to this column refetches rather than serving stale data.
      void categoryQuery.refetch();
    },
  };
}
