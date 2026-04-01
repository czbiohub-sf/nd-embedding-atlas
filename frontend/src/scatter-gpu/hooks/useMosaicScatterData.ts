import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ScatterData } from "../types";
import type { AxisState } from "../../types";
import { parsePositionBlob, parseCategoryBlob, parseContinuousColorsBlob } from "../utils/parsers";
import { scatterKeys } from "./queryKeys";

export type ColorMode = "categorical" | "continuous";

interface UseMosaicScatterDataOptions {
  axes: AxisState | null;
  /** x column name in obs (e.g. "__ev_X_umap_0__") */
  xCol: string;
  /** y column name in obs (e.g. "__ev_X_umap_1__") */
  yCol: string;
  colorMode: ColorMode;
  /** __ev_{col}_id integer column (categorical mode) */
  categoryCol: string | null;
  /** Original string column name for human-readable category names */
  originalCol?: string | null;
  /** Raw obs column (continuous mode) */
  continuousColCol: string | null;
  /** Colormap name for continuous coloring (default: "viridis") */
  continuousColormap?: string;
  /** Whether to reverse the colormap. Included in query key for cache differentiation.
   *  Server ignores unknown params — safe to wire before backend ships. */
  continuousReversed?: boolean;
  vmin?: number;
  vmax?: number;
  /** Whether the embedding is registered in DuckDB. Prevents premature positions fetch. */
  embeddingLoaded?: boolean;
}

interface UseMosaicScatterDataResult {
  data: ScatterData | null;
  /** Stable string key: `${embeddingKey}:${numCells}`. Changes only when
   *  positions are re-fetched (embedding/axes switch). Use as a GPU re-init
   *  dep instead of a Float32Array reference. */
  positionKey: string | null;
  /** The max-abs divisor used to normalise positions to [-1, 1] on the server. */
  positionScale: number;
  categoryNames: string[];
  colorRange: [number, number] | null;
  loading: boolean;
  error: string | null;
}

/**
 * Bridge hook that fetches position and color data from the binary scatter
 * endpoints and assembles a `ScatterData` object for the GPU scatter plot.
 *
 * Three parallel useQuery calls:
 *  1. Positions — fires when `axes`, `xCol`, or `yCol` changes. Heavy (~4 MB).
 *  2. Categories — fires in parallel with positions when categoryCol is set.
 *  3. Continuous colors — fires in parallel with positions when continuousColCol is set.
 *
 * CRITICAL: colors are NOT gated on positions — they run in parallel.
 * Only the useMemo assembly blocks on positions.
 *
 * When multiple panels show the same embedding, TanStack Query deduplicates
 * fetch requests via the query key cache.
 */
export function useMosaicScatterData({
  axes,
  xCol,
  yCol,
  colorMode,
  categoryCol,
  originalCol,
  continuousColCol,
  continuousColormap = "viridis",
  continuousReversed = false,
  vmin,
  vmax,
  embeddingLoaded = true,
}: UseMosaicScatterDataOptions): UseMosaicScatterDataResult {
  // 1. Positions query
  const positionQuery = useQuery({
    queryKey: axes ? scatterKeys.positions(axes.obsmKey, xCol, yCol) : ["scatter", "positions", null],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        embedding: axes!.obsmKey,
        x_col: xCol,
        y_col: yCol,
      });
      const r = await fetch(`/api/scatter-positions?${params}`, { signal });
      if (!r.ok) throw new Error(`scatter-positions failed: ${r.status}`);
      const buf = await r.arrayBuffer();
      const { header, positions } = parsePositionBlob(buf);
      // Copy to prevent stale ArrayBuffer reference across React Query cache evictions
      return {
        floats: new Float32Array(positions),
        rowIndices: header.rowIndices,
        numCells: header.numCells,
        embeddingKey: header.embeddingKey,
        positionScale: header.positionScale,
      };
    },
    enabled: !!axes && embeddingLoaded,
    staleTime: 5 * 60 * 1000,
  });

  // 2. Categories — NOT blocked by positions (parallel)
  const categoryQuery = useQuery({
    queryKey: scatterKeys.categories(categoryCol!, originalCol),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ cat_col: categoryCol! });
      if (originalCol) params.set("original_col", originalCol);
      const r = await fetch(`/api/scatter-categories?${params}`, { signal });
      if (!r.ok) throw new Error(`scatter-categories failed: ${r.status}`);
      const buf = await r.arrayBuffer();
      const { header, categoryIndices } = parseCategoryBlob(buf);
      return { categoryIndices, categoryNames: header.categoryNames };
    },
    enabled: colorMode === "categorical" && !!categoryCol, // no !!positionQuery.data — parallel
    staleTime: 30_000,
  });

  // 3. Continuous colors — NOT blocked by positions (parallel)
  //    `continuousReversed` is in the query key for cache differentiation.
  //    The server ignores unknown params — safe before backend ships reversed support.
  const continuousQuery = useQuery({
    queryKey: [
      ...scatterKeys.continuousColors(continuousColCol!, continuousColormap, vmin, vmax),
      continuousReversed,
    ],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        color_col: continuousColCol!,
        colormap: continuousColormap,
      });
      if (vmin != null) params.set("vmin", String(vmin));
      if (vmax != null) params.set("vmax", String(vmax));
      // TODO: add scale to query key when /api/scatter-continuous-colors supports ?scale=log
      if (continuousReversed) params.set("reversed", "true");
      const r = await fetch(`/api/scatter-continuous-colors?${params}`, { signal });
      if (!r.ok) throw new Error(`scatter-continuous-colors failed: ${r.status}`);
      const buf = await r.arrayBuffer();
      const { header, rgba } = parseContinuousColorsBlob(buf);
      return { rgba, vmin: header.vmin, vmax: header.vmax };
    },
    enabled: colorMode === "continuous" && !!continuousColCol, // no !!positionQuery.data — parallel
    staleTime: 30_000,
  });

  // Assembly blocks on positions only — colors show when ready
  const data = useMemo((): ScatterData | null => {
    if (!positionQuery.data) return null;

    const base = {
      positions: positionQuery.data.floats,
      numCells: positionQuery.data.numCells,
      rowIndices: positionQuery.data.rowIndices,
      embeddingKey: positionQuery.data.embeddingKey,
      ndim: 2 as const,
    };

    if (colorMode === "categorical") {
      const catData = categoryQuery.data;
      return {
        ...base,
        categoryIndices: catData?.categoryIndices ?? new Uint8Array(positionQuery.data.numCells),
        categoryNames: catData?.categoryNames ?? [],
      };
    } else {
      const contData = continuousQuery.data;
      return {
        ...base,
        categoryIndices: new Uint8Array(positionQuery.data.numCells),
        categoryNames: [],
        colorValues: contData?.rgba ?? undefined,
      };
    }
  }, [positionQuery.data, colorMode, categoryQuery.data, continuousQuery.data]);

  const positionKey = positionQuery.data ? `${positionQuery.data.embeddingKey}:${positionQuery.data.numCells}` : null;

  const categoryNames = categoryQuery.data?.categoryNames ?? [];
  const colorRange: [number, number] | null = continuousQuery.data
    ? [continuousQuery.data.vmin, continuousQuery.data.vmax]
    : null;

  const loading = positionQuery.isFetching || categoryQuery.isFetching || continuousQuery.isFetching;
  const error =
    (positionQuery.error as Error | null)?.message ??
    (categoryQuery.error as Error | null)?.message ??
    (continuousQuery.error as Error | null)?.message ??
    null;

  return {
    data,
    positionKey,
    positionScale: positionQuery.data?.positionScale ?? 1,
    categoryNames,
    colorRange,
    loading,
    error,
  };
}
