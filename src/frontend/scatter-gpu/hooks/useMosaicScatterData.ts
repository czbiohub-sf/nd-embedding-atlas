import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { AxisState } from "../../types";
import type { ScatterData } from "../types";
import { parseCategoryBlob, parseContinuousValuesBlob, parsePositionBlob } from "../utils/parsers";
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
  vmin: _vmin,
  vmax: _vmax,
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
    // Embedding coords are immutable for a dataset — hold forever.
    staleTime: Infinity,
    // Keep the prior dim's positions rendering while the new slice
    // resolves; avoids a flash-of-nothing when the user switches axes.
    placeholderData: keepPreviousData,
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

  // 3. Continuous values — NOT blocked by positions (parallel).
  //    Phase 7: fetch raw f32 values only. vmin/vmax come back from the
  //    backend's autocompute; user-driven slider range is applied via the
  //    handle uniform without re-fetching. Colormap and reversed also stay
  //    frontend-only (LUT generated via ochre), so they're NOT in the query
  //    key — only column change triggers a re-fetch.
  const continuousQuery = useQuery({
    queryKey: scatterKeys.continuousColors(continuousColCol!, "values"),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ color_col: continuousColCol! });
      const r = await fetch(`/api/scatter-continuous-values?${params}`, { signal });
      if (!r.ok) throw new Error(`scatter-continuous-values failed: ${r.status}`);
      const buf = await r.arrayBuffer();
      const { header, values } = parseContinuousValuesBlob(buf);
      return { values, vmin: header.vmin, vmax: header.vmax };
    },
    enabled: colorMode === "continuous" && !!continuousColCol,
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
        continuous: contData
          ? {
              values: contData.values,
              vmin: contData.vmin,
              vmax: contData.vmax,
              colormap: continuousColormap,
              reversed: continuousReversed ?? false,
            }
          : undefined,
      };
    }
  }, [positionQuery.data, colorMode, categoryQuery.data, continuousQuery.data, continuousColormap, continuousReversed]);

  // Derive positionKey from the *data snapshot*, not from the hook's
  // props. With `placeholderData: keepPreviousData`, `positionQuery.data`
  // lags behind xCol/yCol during the fetch — keying off props here would
  // advance the key before the fetch resolved, causing the GPU to re-init
  // with stale positions. `dataUpdatedAt` only ticks when fresh data
  // actually lands in the cache (fetch resolution OR cache-hit on an
  // already-populated key), so it always matches the currently rendered
  // `data.positions`.
  const positionKey = positionQuery.data
    ? `${positionQuery.data.embeddingKey}:${positionQuery.data.numCells}:${positionQuery.dataUpdatedAt}`
    : null;

  const categoryNames = categoryQuery.data?.categoryNames ?? [];
  const colorRange: [number, number] | null = continuousQuery.data
    ? [continuousQuery.data.vmin, continuousQuery.data.vmax]
    : null;

  const loading = positionQuery.isFetching || categoryQuery.isFetching || continuousQuery.isFetching;
  const error = positionQuery.error?.message ?? categoryQuery.error?.message ?? continuousQuery.error?.message ?? null;

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
