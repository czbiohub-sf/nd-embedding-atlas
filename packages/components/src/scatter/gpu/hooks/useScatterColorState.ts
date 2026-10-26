import type { Coordinator } from "@uwdata/mosaic-core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { quoteIdent } from "@ndea/protocol";
import { useColumns } from "../../../query/columns";
import { toRows } from "../../../query/mosaic";
import { useScatterHost, useScatterServices } from "../../context";
import type { CategoryMapping, ColorMode } from "../../contracts";
import { colorSourceFromString, colorSourceToString, resolveColorMode } from "../../helpers";
import type { ColorSource } from "../../helpers";

export interface ScatterColorState {
  // Column selection
  colorByColumn: string | null;
  setColorByColumn: (col: string | null) => void;
  // ColorSource API (new: preferred over raw string)
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

export function useScatterColorState(coordinator: Coordinator): ScatterColorState {
  const services = useScatterServices();
  // ── Column selection ────────────────────────────────────────────────────────
  const host = useScatterHost();
  const [localColumn, setLocalColumn] = useState<string | null>(host.config.colorByColumn);
  const subscribeColor = useCallback((cb: () => void) => host.colorBy.subscribe(cb), [host]);
  const getColor = useCallback(() => host.colorBy.get(), [host]);
  const linkedColumn = useSyncExternalStore(subscribeColor, getColor);
  const colorByColumn = host.colorBy.linked ? linkedColumn : localColumn;
  const setColorByColumn = useCallback(
    (column: string | null) => {
      if (host.colorBy.linked) host.colorBy.set(column);
      else {
        setLocalColumn(column);
        host.patchConfig({ colorByColumn: column });
      }
    },
    [host],
  );
  // Color-by lists every catalog column but var expression columns (picked from the Var tab).
  const columns = useColumns();
  const obsColumns = useMemo(
    () => [...(columns?.values() ?? [])].filter((c) => c.kind !== "var").map((c) => c.name),
    [columns],
  );

  // ── Color mode (categorical vs continuous) ──────────────────────────────────
  const [colorModeOverride, setColorModeOverride] = useState<ColorMode | undefined>();

  const colorModeInfo = useMemo(
    () => resolveColorMode(colorByColumn, columns, colorModeOverride),
    [colorByColumn, columns, colorModeOverride],
  );
  const colorMode: ColorMode = colorModeInfo.mode;

  // ── Colormap state ──────────────────────────────────────────────────────────
  // Default is auto-picked per category count on column change (see below).
  // User's explicit pick via setCategoricalColormap is preserved
  // within a column but reset when the column changes.
  const [categoricalColormap, setCategoricalColormapInternal] = useState("tab10");
  const [userExplicitPalette, setUserExplicitPalette] = useState(false);
  const setCategoricalColormap = (c: string) => {
    setUserExplicitPalette(true);
    setCategoricalColormapInternal(c);
  };
  const [continuousColormap, setContinuousColormap] = useState("viridis");
  const [maxCategories, setMaxCategories] = useState(64);

  // Colormap lists + palette: sync, referentially stable per (name, n).
  const { categorical: categoricalColormaps, continuous: continuousColormaps } = services.getColormapList();
  const palette = services.getCategoricalPalette(categoricalColormap, maxCategories);

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
        `SELECT COUNT(DISTINCT CAST(${quoteIdent(col)} AS TEXT))::INT AS n FROM obs_base`,
      );
      const n = Math.min(toRows<{ n: number }>(countResult)[0]?.n ?? 64, 256);
      const mapping = await services.categorize(coordinator, col, n);
      return { n, mapping };
    },
  });

  const categoryMapping = categoryQuery.data?.mapping ?? null;
  const categoryLoading = categoryQuery.isFetching;

  // Adjust state during render when the column or discovered category count
  // changes: a fresh column drops the "user explicit" palette flag, and a new
  // count sizes the palette and auto-picks its default unless the user chose one.
  const categoryCount = categoryQuery.data?.n;
  const [prevColumn, setPrevColumn] = useState(colorByColumn);
  const [prevCount, setPrevCount] = useState(categoryCount);
  let explicitPalette = userExplicitPalette;
  if (colorByColumn !== prevColumn) {
    setPrevColumn(colorByColumn);
    explicitPalette = false;
    setUserExplicitPalette(false);
  }
  if (categoryCount !== prevCount) {
    setPrevCount(categoryCount);
    if (categoryCount != null) {
      setMaxCategories(categoryCount);
      if (!explicitPalette) setCategoricalColormapInternal(services.pickDefaultCategoricalPalette(categoryCount));
    }
  }

  // Re-apply palette to existing mapping without touching DuckDB.
  // Return null (not categoryMapping) when palette isn't loaded yet: empty
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
  const setColorSource = useCallback(
    (src: ColorSource) => setColorByColumn(colorSourceToString(src)),
    [setColorByColumn],
  );

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
