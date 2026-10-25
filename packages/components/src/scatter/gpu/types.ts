import type { TgpuRoot } from "typegpu";
import type { PanZoomView, TurntableView } from "@ndea/sdk";
import type { GpuPointIndex, SelectionCombine } from "../contracts";
import type { ScatterGPUHostHandle } from "./handle-capabilities";

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
  /** Enable the lasso tool. Default: true */
  lasso?: boolean;
  /** Enable the box (marquee) tool. Default: true */
  marquee?: boolean;
}

/**
 * Low-level GPU scatterplot handle returned by createScatterplot(): every
 * capability of the React-layer `ScatterGPUHostHandle` (`gpu/handle-capabilities.ts`)
 * plus the lifecycle and trajectory-path setters that only `ScatterGPUHost` calls.
 */
export interface ScatterplotHandle extends ScatterGPUHostHandle {
  /** The canvas was resized (its pixel size is already set). */
  resize(): void;
  destroy(): void;
  /**
   * Trajectory line pass, drawn in the points' render pass (depth-tested in 3D). 8 floats per
   * frame: normalized world x, y, z (0 in 2D), kind (1 = active frame, 0 = frame, -1 = break
   * between trajectories), then straight linear-RGB r, g, b, a. null = none.
   */
  setTrajectoryPath(path: Float32Array | null): void;
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
    /**
     * Lasso/marquee count while dragging; on pointer-up also the drawn shape's row bitmask
     * (N/32 words) and how it meets the current selection (shift adds, ⌥ subtracts).
     */
    onSelectionChange?: (count: number | null, bits?: Uint32Array<ArrayBuffer>, combine?: SelectionCombine) => void;
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
