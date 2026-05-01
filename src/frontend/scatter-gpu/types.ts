import type { TgpuRoot } from "typegpu";
import type { ViewState } from "../types";

export type { PanelId } from "../lib/branded-types";
export { panelId } from "../lib/branded-types";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export interface ScatterData {
  /** Float32Array of interleaved positions: [x0,y0, ...] normalized to [-1,1] */
  positions: Float32Array;
  /** Category index per cell (u8) */
  categoryIndices: Uint8Array;
  /** Category names */
  categoryNames: string[];
  /** Number of cells */
  numCells: number;
  /** Float32Array index → __row_index__ in DuckDB */
  rowIndices: number[];
  /** Name of the embedding used */
  embeddingKey: string;
  /** Number of dimensions (2 or 3) */
  ndim: 2 | 3;

  /**
   * Continuous-coloring context. When present, the scatter GPU host should
   * dispatch the continuous color-pack kernel (normalize → LUT lookup) via
   * `updateContinuousColors`. Absent for categorical coloring.
   *
   * Values are raw (NaNs preserved); `vmin`/`vmax` are the autocomputed
   * absolute range from the backend. Per-session user-overridden range lives
   * outside ScatterData and is applied via `setContinuousRange`.
   */
  continuous?: {
    values: Float32Array;
    vmin: number;
    vmax: number;
    colormap: string;
    reversed: boolean;
  };

  /** relative size per point — enables encoding by expression */
  sizeValues?: Float32Array;
  /** LOD tile viewport */
  viewport?: readonly [xMin: number, xMax: number, yMin: number, yMax: number];
}

export interface EmbeddingInfo {
  key: string;
  maxNdim: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type ColorMapper = (
  categoryIndex: number,
  pointIndex: number,
  totalCategories: number,
) => [r: number, g: number, b: number];

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
 * Low-level GPU scatterplot handle — returned by createScatterplot().
 * For the React-layer imperative handle exposed via forwardRef, see:
 * scatter-gpu/handle-capabilities.ts → ScatterGPUHostHandle
 */
export interface ScatterplotHandle {
  resize(width: number, height: number): void;
  destroy(): void;
  /** Update color buffer from palette without GPU re-initialization (categorical coloring). */
  updateColors(palette: readonly (readonly [number, number, number, number?])[], categoryIndices?: Uint8Array): void;
  /**
   * Configure continuous coloring (Phase 7 — GPU LUT lookup).
   * Uploads raw values + 256-entry packed-u32 LUT + config, then dispatches the
   * continuous color-pack kernel. Subsequent slider drags or reverse toggles
   * should go through {@link setContinuousRange} / {@link setContinuousReversed}
   * to skip the values + LUT upload.
   */
  updateContinuousColors(args: {
    values: Float32Array;
    vmin: number;
    vmax: number;
    lut: Uint32Array;
    reversed: boolean;
    scale?: "linear" | "log" | "sqrt";
  }): void;
  /** Write new vmin/vmax and re-dispatch (no network, no buffer upload). */
  setContinuousRange(vmin: number, vmax: number): void;
  /** Flip the reversed flag and re-dispatch (no network, no buffer upload). */
  setContinuousReversed(reversed: boolean): void;
  /** Set the normalization scale (linear | log | sqrt) and re-dispatch. */
  setContinuousScale(scale: "linear" | "log" | "sqrt"): void;
  /** Upload a fresh LUT (colormap change) and re-dispatch. */
  setContinuousLut(lut: Uint32Array): void;
  /** Current pan/zoom state of the viewport. */
  getViewState(): ViewState;
  /** Convert world coordinates to screen pixel coordinates using the current view transform. */
  worldToScreen(worldX: number, worldY: number, canvasWidth: number, canvasHeight: number): { x: number; y: number };
  /** Apply an externally-driven selection (from another panel). rowIndices = app-level row IDs; panelRowIndices = this panel's rowIndicesRef. */
  setExternalSelection(rowIndices: number[]): void;
  /** Switch the drag behaviour: 'pan' = default, 'marquee'/'lasso' = always-draw-selection. */
  setForcedSelectionMode(mode: "pan" | "marquee" | "lasso"): void;
  /** Clear an externally-driven selection. */
  clearExternalSelection(): void;
  /** Clear lasso/marquee selection. */
  clearSelection(): void;
  /** Dim points whose category index is not in isolatedSet (legend isolation). Pass empty Set to clear. */
  setCategoryIsolation(isolatedSet: Set<number>, categoryIndices: Uint8Array): void;
  /** Remove category isolation dimming. */
  clearCategoryIsolation(): void;
  /** Mark categories as disabled — points are not clickable. Render alpha=0 is handled by legend. */
  setCategoryDisabled(disabledSet: Set<number>, categoryIndices: Uint8Array): void;
  /** Clear all disabled-category click filtering. */
  clearCategoryDisabled(): void;
  /** Isolate trajectory points (always visible regardless of category filter). */
  setTrajectoryIsolation(rowIndices: number[]): void;
  /** Remove trajectory isolation. */
  clearTrajectoryIsolation(): void;
  /** Isolate continuous range filter points. */
  setContinuousIsolation(rowIndices: number[]): void;
  /** Remove continuous range isolation. */
  clearContinuousIsolation(): void;
  /** Re-upload all isolation masks after GPU reinit. */
  rehydrateIsolation(): void;
  /** Clear the single-point highlight. */
  clearHighlight(): void;
  /** Highlight multiple points (e.g. trajectory points — always full bright). */
  setHighlightPoints(rowIndices: number[]): void;
  /** Programmatically set the view state (for view lock sync). Suppresses the onViewChange broadcast for this write. */
  setViewState(state: ViewState): void;
  /** Animate to a view state using easeInOutQuint over durationMs (default 600ms). */
  animateToViewState(state: ViewState, durationMs?: number): void;
  /** Update point size without GPU re-initialization. */
  setPointRadius(radius: number): void;
  /**
   * Update the per-point alpha multiplier. Default 0.7. Drives how
   * aggressively overlapping points sum under additive blending — at
   * 1.0 a single point dominates, at 0.3 you need ~3 to saturate.
   */
  setPointOpacity(opacity: number): void;
  /** Update HDR settings (tone mapping, exposure). */
  setHdrSettings(settings: { toneMapping?: "none" | "reinhard" | "aces" | "agx" | "neutral"; exposure?: number }): void;
  /**
   * Switch the scatter pipeline blend mode at runtime. All three variants
   * are pre-built at init, so this is a single-object-lookup swap with no
   * pipeline rebuild cost.
   */
  setBlendMode(mode: "additive" | "premultiplied" | "max"): void;
}

export interface RenderConfig {
  /** Point radius in NDC units. Default: 0.003 */
  pointRadius?: number;
  /** Background clear color [r, g, b, a] in 0–1 range. Default: [0.06, 0.06, 0.1, 1] */
  backgroundColor?: [number, number, number, number];
  /** Selection dim factor (0 = fully dimmed, 1 = no dim). Default: 0.08 */
  selectionDimFactor?: number;
  /** Display gamma for compositing pass. Default: 2.2 */
  gamma?: number;
  /**
   * Per-point alpha multiplier for the fragment shader. Default 0.7.
   * Drives how aggressively overlapping points sum under additive
   * blending.
   */
  pointOpacity?: number;
  /**
   * Initial scatter blend mode. Default `"additive"`. See
   * `pipeline.ts:BlendMode` for the trade-offs of each mode.
   */
  blendMode?: "additive" | "premultiplied" | "max";
  /**
   * Color mode for points. Default: "categorical".
   * v2: "continuous" uses colorValues Float32Array for gradient coloring.
   */
  colorMode?: "categorical" | "continuous";
}

export interface ScatterplotConfig {
  render?: RenderConfig;
  interaction?: InteractionConfig;
  /** Custom color mapper. Default: palette-based categorical coloring */
  colorMapper?: ColorMapper;
  /** Color palette (RGB tuples). Used when no colorMapper is provided */
  palette?: readonly (readonly [number, number, number])[];
  callbacks?: {
    onSelectionChange?: (count: number | null, indices?: number[]) => void;
    /** Called when an external selection is cleared by another panel. Only updates
     *  status bar — must NOT call clearSelectionSync to avoid cross-panel cascade. */
    onExternalClear?: () => void;
    onViewChange?: (state: ViewState) => void;
    onPointClick?: (index: number, position: [number, number], categoryIndex: number, categoryName: string) => void;
    /** Called when the user clicks on empty space (no point hit). */
    onBackgroundClick?: () => void;
    onFps?: (fps: number) => void;
  };
}

// ---------------------------------------------------------------------------
// Re-export TgpuRoot for GPU modules
// ---------------------------------------------------------------------------
export type { TgpuRoot };
