import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import type { CategoryLegendItem, CategoryMapping } from "../../lib/category-column";

// ── State ───────────────────────────────────────────────────────────────────

export interface LegendState {
  mode: "categorical" | "continuous";
  // Categorical
  isolatedIndices: Set<number>;
  colorOverrides: Map<number, string>;
  disabledIndices: Set<number>;
  // Continuous (Phase 2)
  colormapName: string;
  colormapReversed: boolean;
  range: [number, number];
  scale: "linear" | "log" | "sqrt";
}

// ── Actions ─────────────────────────────────────────────────────────────────

export interface LegendActions {
  setMode: (mode: "categorical" | "continuous") => void;
  toggleIsolation: (index: number, additive: boolean) => void;
  clearIsolation: () => void;
  setColorOverride: (index: number, color: string) => void;
  clearColorOverride: (index: number) => void;
  toggleDisabled: (index: number) => void;
  clearDisabled: () => void;
  setColormap: (name: string) => void;
  setColormapReversed: (reversed: boolean) => void;
  setRange: (range: [number, number]) => void;
  setScale: (scale: "linear" | "log" | "sqrt") => void;
}

// ── Meta ────────────────────────────────────────────────────────────────────

export interface LegendMeta {
  legend: CategoryLegendItem[];
  colormapLUT: string[] | null;
  dataRange: [number, number];
  // Mosaic infrastructure for reactive queries
  coordinator: Coordinator;
  selection: Selection;
  table: string;
  categoryCol: string | null;
  /** Clears the category mapping when the __ev__* column is missing after backend restart. */
  onStaleColumn?: () => void;
}

// ── Context ─────────────────────────────────────────────────────────────────

export interface LegendContextValue {
  state: LegendState;
  actions: LegendActions;
  meta: LegendMeta;
}

// eslint-disable-next-line react/only-export-components
export const LegendContext = createContext<LegendContextValue | null>(null);

// eslint-disable-next-line react/only-export-components
export function useLegend(): LegendContextValue {
  const ctx = use(LegendContext);
  if (!ctx) {
    const msg = "useLegend must be used within a LegendProvider";
    throw new Error(msg);
  }
  return ctx;
}

// ── Provider ────────────────────────────────────────────────────────────────

const DIM_COLOR = "#4b556330";
const EMPTY_LEGEND: CategoryLegendItem[] = [];

interface LegendProviderProps {
  categoryMapping: CategoryMapping | null;
  coordinator: Coordinator;
  selection: Selection;
  table: string;
  categoryCol: string | null;
  /** Called whenever the set of isolated category indices changes. */
  onIsolationChange?: (isolatedIndices: Set<number>) => void;
  /** Called when the __ev__* column is missing from the VIEW (stale after backend restart). */
  onStaleColumn?: () => void;
  children: React.ReactNode;
}

export function LegendProvider({
  categoryMapping,
  coordinator,
  selection,
  table,
  categoryCol,
  onIsolationChange,
  onStaleColumn,
  children,
}: LegendProviderProps) {
  const [mode, setMode] = useState<"categorical" | "continuous">("categorical");
  const [isolatedIndices, setIsolatedIndices] = useState(new Set());
  const [colorOverrides, setColorOverrides] = useState(new Map());
  const [disabledIndices, setDisabledIndices] = useState(new Set());

  // ── Notify parent of isolation changes so it can update Mosaic ────────────
  // Mosaic's brushSelection.update() must be called from ScatterPanel where
  // it correctly integrates with the coordinator's event dispatch cycle.
  useEffect(() => {
    onIsolationChange?.(isolatedIndices);
  }, [isolatedIndices, onIsolationChange]);
  const [colormapName, setColormapName] = useState("viridis");
  const [colormapReversed, setColormapReversed] = useState(false);
  const [range, setRange] = useState([0, 1]);
  const [scale, setScale] = useState<"linear" | "log" | "sqrt">("linear");

  const toggleIsolation = useCallback((index: number, additive: boolean) => {
    setIsolatedIndices((prev) => {
      if (additive) {
        const next = new Set(prev);
        if (prev.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next.size > 0 ? next : new Set();
      }
      // Non-additive: if already the sole selection, deselect; otherwise isolate just this
      if (prev.size === 1 && prev.has(index)) {
        return new Set();
      }
      return new Set([index]);
    });
  }, []);

  const clearIsolation = useCallback(() => {
    setIsolatedIndices(new Set());
  }, []);

  const setColorOverride = useCallback((index: number, color: string) => {
    setColorOverrides((prev) => {
      const next = new Map(prev);
      next.set(index, color);
      return next;
    });
  }, []);

  const clearColorOverride = useCallback((index: number) => {
    setColorOverrides((prev) => {
      const next = new Map(prev);
      next.delete(index);
      return next;
    });
  }, []);

  const toggleDisabled = useCallback((index: number) => {
    setDisabledIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const clearDisabled = useCallback(() => setDisabledIndices(new Set()), []);

  const state: LegendState = useMemo(
    () => ({
      mode,
      isolatedIndices,
      colorOverrides,
      disabledIndices,
      colormapName,
      colormapReversed,
      range,
      scale,
    }),
    [mode, isolatedIndices, colorOverrides, disabledIndices, colormapName, colormapReversed, range, scale],
  );

  const actions: LegendActions = useMemo(
    () => ({
      setMode,
      toggleIsolation,
      clearIsolation,
      setColorOverride,
      clearColorOverride,
      toggleDisabled,
      clearDisabled,
      setColormap: setColormapName,
      setColormapReversed,
      setRange,
      setScale,
    }),
    [toggleIsolation, clearIsolation, setColorOverride, clearColorOverride, toggleDisabled, clearDisabled],
  );

  const legend = categoryMapping?.legend ?? EMPTY_LEGEND;

  const meta: LegendMeta = useMemo(
    () => ({
      legend,
      colormapLUT: null, // Phase 2
      dataRange: [0, 1] as [number, number], // Phase 2
      coordinator,
      selection,
      table,
      categoryCol,
      onStaleColumn,
    }),
    [legend, coordinator, selection, table, categoryCol, onStaleColumn],
  );

  const value: LegendContextValue = useMemo(() => ({ state, actions, meta }), [state, actions, meta]);

  return <LegendContext value={value}>{children}</LegendContext>;
}

// ── Derived: effective colors (merges overrides + isolation) ────────────────

// eslint-disable-next-line react/only-export-components
export function useEffectiveCategoryColors(): string[] | null {
  const { state, meta } = useLegend();
  const { legend } = meta;
  const { colorOverrides, isolatedIndices, disabledIndices } = state;

  return useMemo(() => {
    if (legend.length === 0) return null;

    const hasIsolation = isolatedIndices.size > 0;

    return legend.map((item) => {
      // Priority: disabled > isolation-dim > normal
      if (disabledIndices.has(item.index)) return "#00000000"; // alpha=0
      const baseColor = colorOverrides.get(item.index) ?? item.color;
      if (hasIsolation && !isolatedIndices.has(item.index)) {
        return DIM_COLOR;
      }
      return baseColor;
    });
  }, [legend, colorOverrides, isolatedIndices, disabledIndices]);
}
