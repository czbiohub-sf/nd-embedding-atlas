import { useEffect, useMemo, useState } from "react";
import type { ScatterData } from "../types";
import type { AxisState } from "../../types";
import { parsePositionBlob, parseCategoryBlob, parseContinuousColorsBlob } from "../utils/parsers";

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
  vmin?: number;
  vmax?: number;
}

interface UseMosaicScatterDataResult {
  data: ScatterData | null;
  categoryNames: string[];
  colorRange: [number, number] | null;
  loading: boolean;
  error: string | null;
}

/** Parsed positions held in state between color changes */
interface PositionState {
  floats: Float32Array;
  rowIndices: number[];
  numCells: number;
  embeddingKey: string;
}

/**
 * Bridge hook that fetches position and color data from the binary scatter
 * endpoints and assembles a `ScatterData` object for the GPU scatter plot.
 *
 * Two independent fetch effects:
 *  1. Positions — fires when `axes`, `xCol`, or `yCol` changes. Heavy (~4 MB).
 *  2. Colors    — fires when `colorMode`, `categoryCol`, or `continuousColCol`
 *                 changes AND positions are loaded. Lightweight.
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
  vmin,
  vmax,
}: UseMosaicScatterDataOptions): UseMosaicScatterDataResult {
  // --- Position state (heavy, persists while axes stay the same) ---
  const [positions, setPositions] = useState<PositionState | null>(null);
  const [posLoading, setPosLoading] = useState(false);

  // --- Color state (lightweight, changes on colorBy change) ---
  const [categoryIndices, setCategoryIndices] = useState<Uint8Array | null>(null);
  const [categoryNames, setCategoryNames] = useState<string[]>([]);
  const [colorValues, setColorValues] = useState<Float32Array | null>(null);
  const [colorRange, setColorRange] = useState<[number, number] | null>(null);
  const [colorLoading, setColorLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Effect 1: fetch positions when axes / column names change
  useEffect(() => {
    if (!axes) {
      setPositions(null);
      return;
    }

    const ac = new AbortController();
    setPosLoading(true);
    setError(null);

    const params = new URLSearchParams({
      embedding: axes.obsmKey,
      x_col: xCol,
      y_col: yCol,
    });

    fetch(`/api/scatter-positions?${params}`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`scatter-positions failed: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const { header, positions: floats } = parsePositionBlob(buf);
        setPositions({
          floats,
          rowIndices: header.row_indices,
          numCells: header.num_points,
          embeddingKey: header.embedding_key,
        });
        // Reset color state whenever positions change
        setCategoryIndices(null);
        setCategoryNames([]);
        setColorValues(null);
        setColorRange(null);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => setPosLoading(false));

    return () => ac.abort();
  }, [axes, xCol, yCol]);

  // Effect 2: fetch categories or continuous colors when color config changes
  useEffect(() => {
    if (!positions) return;

    if (colorMode === "categorical") {
      if (!categoryCol) {
        setCategoryIndices(new Uint8Array(positions.numCells));
        setCategoryNames([]);
        return;
      }

      const ac = new AbortController();
      setColorLoading(true);

      const params = new URLSearchParams({ cat_col: categoryCol });
      if (originalCol) params.set("original_col", originalCol);

      fetch(`/api/scatter-categories?${params}`, { signal: ac.signal })
        .then((r) => {
          if (!r.ok) throw new Error(`scatter-categories failed: ${r.status}`);
          return r.arrayBuffer();
        })
        .then((buf) => {
          const { header, categoryIndices: indices } = parseCategoryBlob(buf);
          setCategoryIndices(indices);
          setCategoryNames(header.category_names);
          setColorValues(null);
          setColorRange(null);
        })
        .catch((e: Error) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => setColorLoading(false));

      return () => ac.abort();
    } else {
      // continuous
      if (!continuousColCol) {
        setColorValues(null);
        setColorRange(null);
        return;
      }

      const ac = new AbortController();
      setColorLoading(true);

      const params = new URLSearchParams({
        color_col: continuousColCol,
        colormap: continuousColormap,
      });
      if (vmin != null) params.set("vmin", String(vmin));
      if (vmax != null) params.set("vmax", String(vmax));

      fetch(`/api/scatter-continuous-colors?${params}`, { signal: ac.signal })
        .then((r) => {
          if (!r.ok) throw new Error(`scatter-continuous-colors failed: ${r.status}`);
          return r.arrayBuffer();
        })
        .then((buf) => {
          const { header, rgba } = parseContinuousColorsBlob(buf);
          setColorValues(rgba);
          setColorRange([header.vmin, header.vmax]);
          setCategoryIndices(null);
          setCategoryNames([]);
        })
        .catch((e: Error) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => setColorLoading(false));

      return () => ac.abort();
    }
  }, [positions, colorMode, categoryCol, originalCol, continuousColCol, continuousColormap, vmin, vmax]);

  // Merge positions + colors into ScatterData
  const data = useMemo((): ScatterData | null => {
    if (!positions) return null;

    const base = {
      positions: positions.floats,
      numCells: positions.numCells,
      rowIndices: positions.rowIndices,
      embeddingKey: positions.embeddingKey,
      ndim: 2 as const,
    };

    if (colorMode === "categorical") {
      return {
        ...base,
        categoryIndices: categoryIndices ?? new Uint8Array(positions.numCells),
        categoryNames,
      };
    } else {
      return {
        ...base,
        categoryIndices: new Uint8Array(positions.numCells),
        categoryNames: [],
        colorValues: colorValues ?? undefined,
      };
    }
  }, [positions, colorMode, categoryIndices, categoryNames, colorValues]);

  return {
    data,
    categoryNames,
    colorRange,
    loading: posLoading || colorLoading,
    error,
  };
}
