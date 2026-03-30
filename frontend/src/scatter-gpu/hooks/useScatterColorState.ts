import { useEffect, useMemo, useState } from "react";
import type { Coordinator } from "@uwdata/mosaic-core";
import { useColormapList, useColormapPalette } from "../../hooks/useColormaps";
import { useColumnTypes } from "../../hooks/useColumnTypes";
import { resolveColorMode } from "../../hooks/useColorMode";
import type { ColorMode } from "../../hooks/useColorMode";
import { makeCategoryColumn, type CategoryMapping } from "../../lib/category-column";
import { toRows } from "../../lib/mosaic-helpers";
import type { Metadata } from "../../types";

export interface ScatterColorState {
  // Column selection
  colorByColumn: string | null;
  setColorByColumn: (col: string | null) => void;
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
}

export function useScatterColorState(
  coordinator: Coordinator,
  metadata: Metadata,
): ScatterColorState {
  // ── Column selection ────────────────────────────────────────────────────────
  const [colorByColumn, setColorByColumn] = useState<string | null>(null);
  const obsColumns = useMemo(() => metadata.obs_columns ?? [], [metadata.obs_columns]);

  // ── Color mode (categorical vs continuous) ──────────────────────────────────
  const columnTypes = useColumnTypes(coordinator);
  const [colorModeOverride, setColorModeOverride] = useState<ColorMode | undefined>(undefined);

  // Reset override when color column changes
  useEffect(() => {
    setColorModeOverride(undefined);
  }, [colorByColumn]);

  const colorModeInfo = useMemo(
    () => resolveColorMode(colorByColumn, columnTypes, colorModeOverride),
    [colorByColumn, columnTypes, colorModeOverride],
  );
  const colorMode: ColorMode = colorModeInfo.mode;

  // ── Colormap state ──────────────────────────────────────────────────────────
  const [categoricalColormap, setCategoricalColormap] = useState("glasbey");
  const [continuousColormap, setContinuousColormap] = useState("viridis");
  const [maxCategories, setMaxCategories] = useState(64);

  // Colormap lists + palette — cached via TanStack Query (no repeated fetches)
  const colormapListQuery = useColormapList();
  const categoricalColormaps = colormapListQuery.data?.categorical ?? [];
  const continuousColormaps = colormapListQuery.data?.continuous ?? [];

  const paletteQuery = useColormapPalette(categoricalColormap, maxCategories);
  const palette = paletteQuery.data ?? [];

  // ── Category column mapping ─────────────────────────────────────────────────
  const [categoryMapping, setCategoryMapping] = useState<CategoryMapping | null>(null);
  const [categoryLoading, setCategoryLoading] = useState(false);

  useEffect(() => {
    if (!colorByColumn || colorMode !== "categorical") {
      setCategoryMapping(null);
      return;
    }
    let cancelled = false;
    setCategoryLoading(true);

    const run = async () => {
      const countResult = await coordinator.query(
        `SELECT COUNT(DISTINCT CAST("${colorByColumn}" AS TEXT))::INT AS n FROM obs_base`,
        { type: "json" },
      );
      if (cancelled) return;
      const n = Math.min(toRows<{ n: number }>(countResult)[0]?.n ?? 64, 256);
      setMaxCategories(n);

      const mapping = await makeCategoryColumn(coordinator, colorByColumn, n);
      if (!cancelled) {
        setCategoryMapping(mapping);
        setCategoryLoading(false);
      }
    };

    run().catch((err) => {
      console.error("Failed to create category column:", err);
      if (!cancelled) {
        setCategoryMapping(null);
        setCategoryLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [coordinator, colorByColumn, colorMode]);

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

  return {
    colorByColumn,
    setColorByColumn,
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
  };
}
