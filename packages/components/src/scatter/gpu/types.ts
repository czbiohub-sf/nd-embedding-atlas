import type { TgpuRoot } from "typegpu";
import type { PanZoomView, RowIndex, TurntableView, ViewSyncState } from "@ndea/sdk";
import type { DensityMode, GpuPointIndex, SelectionDepth } from "../contracts";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** Point `i` is the observation with `__row_index__ = i`: positions arrive in obs_base row order. */
export interface ScatterData {
  /** Columns of `numCells` f32, normalized to [-1, 1]: x, then y, then z in 3D. */
  positions: Float32Array;
  /** Category index per cell (u8) */
  categoryIndices: Uint8Array;
  /** Category names */
  categoryNames: string[];
  /** Number of cells */
  numCells: number;
  /** Name of the embedding used */
  embeddingKey: string;
  /** Number of dimensions (2 or 3) */
  ndim: 2 | 3;

  /**
   * Continuous coloring: values are raw (NaNs preserved); `vmin`/`vmax` are
   * the backend's autocomputed range. A user-overridden range is applied via
   * `setContinuousRange`. Absent for categorical coloring.
   */
  continuous?: {
    values: Float32Array;
    vmin: number;
    vmax: number;
    colormap: string;
    reversed: boolean;
  };

  /** relative size per point: enables encoding by expression */
  sizeValues?: Float32Array;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface InteractionConfig {
  /** Zoom easing speed (0–1). Default: 0.06 */
  lerpSpeed?: number;
  /** Zoom easing snap threshold. Default: 0.0001 */
  lerpEpsilon?: number;
  /** Per-scroll-tick zoom multiplier (>1 = zoom in). Default: 1.01 */
  zoomSensitivity?: number;
  /** Minimum zoom level. Default: 0.1 */
  minZoom?: number;
  /** Maximum zoom level. Default: 500 */
  maxZoom?: number;
  /** Enable pan. Default: true */
  pan?: boolean;
  /** Enable zoom. Default: true */
  zoom?: boolean;
  /** Enable lasso selection (Shift+Cmd/Ctrl+drag). Default: true */
  lasso?: boolean;
  /** Enable marquee rectangle selection (Shift+drag). Default: true */
  marquee?: boolean;
}

/**
 * Low-level GPU scatterplot handle: returned by createScatterplot().
 * For the React-layer imperative handle exposed via forwardRef, see:
 * scatter-gpu/handle-capabilities.ts → ScatterGPUHostHandle
 */
export interface ScatterplotHandle {
  /** The canvas was resized (its pixel size is already set). */
  resize(): void;
  destroy(): void;
  /** Categorical coloring: palette by category index (a uniform write; indices re-uploaded when given). */
  updateColors(palette: readonly (readonly [number, number, number, number?])[], categoryIndices?: Uint8Array): void;
  /**
   * Continuous coloring: uploads raw values and a 256-entry packed-u32 LUT;
   * colors are computed in the shader. Slider drags and toggles go through
   * the setters below, which are uniform writes.
   */
  updateContinuousColors(args: {
    values: Float32Array;
    vmin: number;
    vmax: number;
    lut: Uint32Array;
    reversed: boolean;
    scale?: "linear" | "log" | "sqrt";
  }): void;
  setContinuousRange(vmin: number, vmax: number): void;
  setContinuousReversed(reversed: boolean): void;
  setContinuousScale(scale: "linear" | "log" | "sqrt"): void;
  /** Upload a fresh LUT (colormap change). */
  setContinuousLut(lut: Uint32Array): void;
  /** Canvas CSS-pixel position of a world point under the current camera; null behind a 3D camera. */
  project(x: number, y: number, z?: number): { x: number; y: number } | null;
  /** Apply an externally-driven selection (from another panel). */
  setExternalSelection(rowIndices: RowIndex[]): void;
  /** Switch the drag behaviour: 'pan' = default, 'marquee'/'lasso' = always-draw-selection. */
  setForcedSelectionMode(mode: "pan" | "marquee" | "lasso"): void;
  /** 3D: select through (default), or only the nearest dense structure under the shape (2D ignores it). */
  setSelectionDepth(depth: SelectionDepth): void;
  /** Clear an externally-driven selection. */
  clearExternalSelection(): void;
  /** Clear lasso/marquee selection. */
  clearSelection(): void;
  /** Show only points whose bit is set in the filter-scope predicate bitmask (missing words = 0). */
  setPredicateFilter(bits: Uint32Array): void;
  /** Remove the filter-scope predicate visibility filter. */
  clearPredicateFilter(): void;
  /** Dim points whose category index is not in `isolated` (legend isolation). Empty set clears. */
  setCategoryIsolation(isolated: Set<number>): void;
  /** Remove category isolation dimming. */
  clearCategoryIsolation(): void;
  /** Hide disabled categories from drawing, picking, and lasso. Empty set clears. */
  setCategoryDisabled(disabled: Set<number>): void;
  clearCategoryDisabled(): void;
  /** Isolate trajectory points (always visible regardless of category filter). */
  setTrajectoryIsolation(rowIndices: RowIndex[]): void;
  /** Remove trajectory isolation. */
  clearTrajectoryIsolation(): void;
  /**
   * Trajectory line pass, drawn in the points' render pass (depth-tested in 3D). 8 floats per
   * frame: normalized world x, y, z (0 in 2D), kind (1 = active frame, 0 = frame, -1 = break
   * between trajectories), then straight linear-RGB r, g, b, a. null = none.
   */
  setTrajectoryPath(path: Float32Array | null): void;
  /** Isolate continuous range filter points. */
  setContinuousIsolation(rowIndices: RowIndex[]): void;
  /** Remove continuous range isolation. */
  clearContinuousIsolation(): void;
  /** Clear the clicked point and the highlight set. */
  clearHighlight(): void;
  /** Highlight multiple points (e.g. trajectory points: always full bright). */
  setHighlightPoints(rowIndices: RowIndex[]): void;
  /** Apply a view-sync state (2D cameras skip 3D cells and vice versa). Suppresses the onViewChange broadcast for this write. */
  setViewState(state: ViewSyncState): void;
  /** Animate to a view that frames every point. */
  fitView(): void;
  /** 3D only: perspective or orthographic projection. */
  setProjection(projection: TurntableView["projection"]): void;
  /** Update point size without GPU re-initialization. */
  setPointRadius(radius: number): void;
  /**
   * Update the per-point alpha multiplier. Default 0.7. Drives how
   * aggressively overlapping points sum under additive blending: at
   * 1.0 a single point dominates, at 0.3 you need ~3 to saturate.
   */
  setPointOpacity(opacity: number): void;
  /** Update HDR settings (tone mapping, exposure). */
  setHdrSettings(settings: { toneMapping?: "none" | "reinhard" | "aces" | "agx" | "neutral"; exposure?: number }): void;
  /** Switch the 2D point blend mode; 3D always draws opaque depth-tested discs. */
  setBlendMode(mode: "additive" | "premultiplied" | "max"): void;
  /** How the density path composites categorical colors (continuous color always averages). */
  setDensityMode(mode: DensityMode): void;
}

export interface RenderConfig {
  /** Point radius in NDC units. Default: 0.002 */
  pointRadius?: number;
  /** Alpha of heavily dimmed (filtered-out) points. Default: 0.08 */
  selectionDimFactor?: number;
  /** Per-point alpha multiplier; how fast overlap sums under additive blending. Default: 1 */
  pointOpacity?: number;
}

export interface ScatterplotConfig {
  render?: RenderConfig;
  interaction?: InteractionConfig;
  callbacks?: {
    /** Lasso/marquee count while dragging; on pointer-up also the lasso bit layer (N/32 words). */
    onSelectionChange?: (count: number | null, bits?: Uint32Array<ArrayBuffer>) => void;
    /** Called when an external row set is cleared by another panel. Only updates
     *  status bar; it must not republish a clear and create a cascade. */
    onExternalClear?: () => void;
    onViewChange?: (state: PanZoomView | TurntableView) => void;
    onPointClick?: (pointIndex: GpuPointIndex) => void;
    /** Called when the user clicks on empty space (no point hit). */
    onBackgroundClick?: () => void;
    onFps?: (fps: number) => void;
  };
}

// ---------------------------------------------------------------------------
// Re-export TgpuRoot for GPU modules
// ---------------------------------------------------------------------------
export type { TgpuRoot };
